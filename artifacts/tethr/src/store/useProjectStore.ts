import { create } from 'zustand';
import { AudioTrack, Clip, PlaybackState, SegmentMode, ToolMode, BpmSource, SnapResolution, SectionMute } from '../types/audio';
import { conformTempoRatio, clearStretchCacheForTrack } from '../lib/timeStretch';
import { detectStructure } from '../lib/structureDetection';
import { clearBeatCorrectionCacheForTrack, detectBeatCorrectionMap } from '../lib/beatCorrection';

function reconformClipsToGrid(clips: Clip[], tracks: AudioTrack[], projectBpm: number): Clip[] {
  return clips.map(c => {
    if (c.conformToProjectBpm === false) return c;
    const track = tracks.find(t => t.id === c.trackId);
    if (!track?.estimatedBpm) return c;
    return { ...c, stretchRatio: conformTempoRatio(track.estimatedBpm, projectBpm) };
  });
}

// ---------------------------------------------------------------------------
// BPM detection — energy autocorrelation, runs inline after decode
// ---------------------------------------------------------------------------
function estimateBPM(audioBuffer: AudioBuffer): { bpm: number | null; confidence: number } {
  try {
    const sampleRate = audioBuffer.sampleRate;
    // Limit to first 60 s for speed
    const maxSamples = Math.min(audioBuffer.length, sampleRate * 60);

    // Mix to mono (first channel only is fine for beat detection)
    const raw = audioBuffer.getChannelData(0);

    // Frame size ~23 ms → ~43 fps analysis rate
    const frameSize = Math.floor(sampleRate * 0.023);
    const numFrames = Math.floor(maxSamples / frameSize);

    if (numFrames < 40) return { bpm: null, confidence: 0 };

    // RMS energy per frame
    const energy = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
      let sum = 0;
      const base = i * frameSize;
      for (let j = 0; j < frameSize; j++) {
        const s = raw[base + j] ?? 0;
        sum += s * s;
      }
      energy[i] = Math.sqrt(sum / frameSize);
    }

    // Onset detection: half-wave rectified first difference of energy
    const onset = new Float32Array(numFrames);
    for (let i = 1; i < numFrames; i++) {
      onset[i] = Math.max(0, energy[i] - energy[i - 1]);
    }

    const fps = sampleRate / frameSize;

    // Lag range for 50–220 BPM
    const lagMin = Math.max(2, Math.floor(fps * 60 / 220));
    const lagMax = Math.ceil(fps * 60 / 50);

    // Autocorrelation of onset signal
    const corr = new Float32Array(lagMax + 1);
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let sum = 0;
      const count = numFrames - lag;
      for (let i = 0; i < count; i++) {
        sum += onset[i] * onset[i + lag];
      }
      corr[lag] = count > 0 ? sum / count : 0;
    }

    // Find best lag in 60–200 BPM range
    const bpmLagMin = Math.max(lagMin, Math.floor(fps * 60 / 200));
    const bpmLagMax = Math.min(lagMax, Math.ceil(fps * 60 / 60));

    let bestLag = bpmLagMin;
    let bestCorr = 0;
    let sumCorr = 0;
    let countLags = 0;

    for (let lag = bpmLagMin; lag <= bpmLagMax; lag++) {
      const c = corr[lag];
      if (c > bestCorr) { bestCorr = c; bestLag = lag; }
      sumCorr += c;
      countLags++;
    }

    const avgCorr = countLags > 0 ? sumCorr / countLags : 1;
    // Confidence = normalized peak-over-mean — 0 when flat, 1 when strong single peak
    const confidence = avgCorr > 0
      ? Math.min(1, Math.max(0, (bestCorr - avgCorr) / avgCorr))
      : 0;

    let rawBpm = fps * 60 / bestLag;

    // Fold into 75–150 BPM canonical range
    while (rawBpm > 150) rawBpm /= 2;
    while (rawBpm < 75) rawBpm *= 2;

    // Round to nearest 0.5 BPM
    const bpm = Math.round(rawBpm * 2) / 2;

    // Reject low-confidence or out-of-range results
    if (confidence < 0.06 || bpm < 50 || bpm > 220) {
      return { bpm: null, confidence };
    }

    return { bpm, confidence };
  } catch {
    return { bpm: null, confidence: 0 };
  }
}

// ---------------------------------------------------------------------------
// Waveform peaks — shared by importTrack and loadProject so both code paths
// produce the same downsampled display data.
// ---------------------------------------------------------------------------
function generateWaveformPeaks(audioBuffer: AudioBuffer, peakCount: number = 2000): Float32Array {
  const channelData = audioBuffer.getChannelData(0);
  const step = Math.ceil(channelData.length / peakCount);
  const peaks = new Float32Array(peakCount);
  for (let i = 0; i < peakCount; i++) {
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step; j++) {
      const d = channelData[i * step + j];
      if (d !== undefined) {
        if (d < min) min = d;
        if (d > max) max = d;
      }
    }
    peaks[i] = Math.max(Math.abs(min), Math.abs(max));
  }
  return peaks;
}

// ---------------------------------------------------------------------------
// Base64 codec for bundling audio bytes inside the .tethr project file.
// Chunked encode avoids "Maximum call stack" on multi-MB buffers.
// ---------------------------------------------------------------------------
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.byteLength))),
    );
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------
interface ProjectState {
  tracks: AudioTrack[];
  arrangementClips: Clip[];
  selectedClipId: string | null;
  selectedTrackId: string | null;
  bpm: number;
  // BPM the currently-playing audio is actually stretched to. Updated by the
  // audio engine whenever it (re)schedules playback. Compared against `bpm`
  // to drive the "APPLY TEMPO" button — BPM drag never auto-restretches.
  appliedBpm: number;
  // True while the audio engine is rendering a tempo change. Set by the
  // APPLY TEMPO handlers; cleared in schedulePlayback's finally block.
  // Drives the ApplyingTempoOverlay and gates Play / Space / duplicate Apply.
  isApplyingTempo: boolean;
  bpmSource: BpmSource;   // 'auto' | 'tap' | 'manual'
  segmentMode: SegmentMode;
  zoomLevel: number;
  scrollPosition: number;
  playbackState: PlaybackState;
  playheadPosition: number;
  playTrigger: number;
  loopRegion: { start: number; end: number } | null;
  isLooping: boolean;
  toolMode: ToolMode;
  projectName: string;
  snapEnabled: boolean;
  snapResolution: SnapResolution;
  snapGuidePosition: number | null;
  metronomeEnabled: boolean;

  importTrack: (file: File) => Promise<void>;
  removeTrack: (id: string) => void;
  setReferenceTrack: (id: string) => void;
  updateTrack: (id: string, updates: Partial<AudioTrack>) => void;
  toggleSectionMute: (trackId: string, region: SectionMute) => void;
  addArrangementClip: (clip: Clip) => void;
  removeArrangementClip: (id: string) => void;
  updateArrangementClip: (id: string, updates: Partial<Clip>) => void;
  splitArrangementClip: (id: string, splitOffset: number) => void;
  duplicateArrangementClip: (id: string) => void;
  selectClip: (id: string | null) => void;
  selectTrack: (id: string | null) => void;
  setBpm: (bpm: number, source?: BpmSource) => void;
  setAppliedBpm: (bpm: number) => void;
  setApplyingTempo: (v: boolean) => void;
  setSegmentMode: (mode: SegmentMode) => void;
  setZoom: (level: number) => void;
  setScroll: (pos: number) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setPlayheadPosition: (pos: number) => void;
  setLoopRegion: (region: { start: number; end: number } | null) => void;
  setToolMode: (mode: ToolMode) => void;
  setSnapEnabled: (v: boolean) => void;
  setSnapResolution: (r: SnapResolution) => void;
  setSnapGuidePosition: (pos: number | null) => void;
  setMetronomeEnabled: (enabled: boolean) => void;
  triggerPlay: (fromPosition?: number) => void;
  saveProject: () => Promise<void>;
  loadProject: (json: string) => Promise<void>;
  undo: () => void;
  redo: () => void;
}

const PAST_STATES: any[] = [];
const FUTURE_STATES: any[] = [];

const COLORS = [
  'hsl(240 100% 72% / 0.78)', // indigo-blue
  'hsl(270 100% 64% / 0.72)', // electric purple
  'hsl(232 58% 64% / 0.70)',  // submerged blue
  'hsl(282 48% 58% / 0.66)',  // ultraviolet shadow
  'hsl(220 22% 58% / 0.62)',  // neutral lane
];

export const useProjectStore = create<ProjectState>((set, get) => ({
  tracks: [],
  arrangementClips: [],
  selectedClipId: null,
  selectedTrackId: null,
  bpm: 120,
  appliedBpm: 120,
  isApplyingTempo: false,
  bpmSource: 'manual',
  segmentMode: 8,
  zoomLevel: 1,
  scrollPosition: 0,
  playbackState: 'stopped',
  playheadPosition: 0,
  playTrigger: 0,
  loopRegion: null,
  isLooping: false,
  toolMode: 'select',
  projectName: 'Untitled Project',
  snapEnabled: true,
  snapResolution: 'bar' as SnapResolution,
  snapGuidePosition: null,
  metronomeEnabled: false,

  importTrack: async (file: File) => {
    // Decode using a temporary AudioContext — closed immediately after
    const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    let audioBuffer: AudioBuffer;
    try {
      const arrayBuffer = await file.arrayBuffer();
      audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
    } finally {
      decodeCtx.close().catch(() => {});
    }

    // BPM detection
    const { bpm: detectedBpm, confidence } = estimateBPM(audioBuffer);

    // Debug logging
    const durMin = Math.floor(audioBuffer.duration / 60);
    const durSec = (audioBuffer.duration % 60).toFixed(1).padStart(4, '0');
    if (detectedBpm !== null) {
      console.log(
        `[TETHR import] "${file.name}" | duration: ${durMin}:${durSec} | BPM: ${detectedBpm} | confidence: ${Math.round(confidence * 100)}% | method: energy-autocorrelation`
      );
    } else {
      console.log(
        `[TETHR import] "${file.name}" | duration: ${durMin}:${durSec} | BPM: unknown | confidence: ${Math.round(confidence * 100)}% | fallback: manual entry required`
      );
    }

    // Waveform peaks (2000 points for display)
    const peaks = generateWaveformPeaks(audioBuffer);

    // Heuristic song-structure detection. Uses detected BPM for bar-window
    // sizing; falls back to project BPM if detection failed.
    const structureBpm = detectedBpm ?? get().bpm;
    const structureSegments = detectStructure(audioBuffer, structureBpm);
    const beatCorrectionMap = detectBeatCorrectionMap(audioBuffer, structureBpm);
    const trackId = crypto.randomUUID();

    if (beatCorrectionMap) {
      console.log(
        `[TETHR auto-correct] beats: ${beatCorrectionMap.markers.length} | avg drift: ${beatCorrectionMap.averageDriftMs.toFixed(1)}ms | max drift: ${beatCorrectionMap.maxDriftMs.toFixed(1)}ms | confidence: ${Math.round(beatCorrectionMap.confidence * 100)}%`,
      );
    } else {
      console.log('[TETHR auto-correct] beat map unavailable | using global pitch-preserving conform fallback');
    }

    const newTrack: AudioTrack = {
      id: trackId,
      name: file.name.replace(/\.[^/.]+$/, ''),
      file,
      fileName: file.name,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      channelCount: audioBuffer.numberOfChannels,
      audioBuffer,
      waveformData: peaks,
      color: COLORS[0],
      isReference: true,
      isMuted: false,
      volume: 1.0,
      estimatedBpm: detectedBpm,
      bpmConfidence: confidence,
      beatCorrectionMap,
      structureSegments,
      sectionMutes: [],
    };

    set((state) => {
      PAST_STATES.push(state);
      // Single-track workflow: each import becomes the active working track.
      // The detected tempo anchors the project grid, and the audio engine's
      // existing SoundTouch source-only path handles pitch-preserving tempo
      // conforming from this one active track.
      const nextBpm = detectedBpm ?? state.bpm;
      const nextBpmSource = detectedBpm !== null ? 'auto' : state.bpmSource;

      // Auto-fit zoom to the imported song with ~10% horizontal breathing
      // room. Matches Timeline's baseVisibleDuration = 30.
      let nextZoom = state.zoomLevel;
      if (audioBuffer.duration > 0) {
        const BASE_VISIBLE_DURATION = 30;
        const targetVisible = audioBuffer.duration * 1.1;
        nextZoom = Math.max(0.05, Math.min(20, BASE_VISIBLE_DURATION / targetVisible));
      }

      return {
        tracks: [newTrack],
        arrangementClips: [],
        selectedClipId: null,
        selectedTrackId: trackId,
        bpm: nextBpm,
        appliedBpm: nextBpm,
        bpmSource: nextBpmSource,
        zoomLevel: nextZoom,
        // Reset playhead + scroll to origin so the timeline ruler / transport
        // counter both read B1 · 0:00 immediately and the waveform starts
        // visually aligned.
        playheadPosition: 0,
        scrollPosition: 0,
        playbackState: 'stopped',
        isApplyingTempo: false,
        loopRegion: null,
      };
    });
  },

  removeTrack: (id: string) => set((state) => {
    PAST_STATES.push(state);
    clearStretchCacheForTrack(id);
    clearBeatCorrectionCacheForTrack(id);
    return {
      tracks: state.tracks.filter(t => t.id !== id),
      arrangementClips: state.arrangementClips.filter(c => c.trackId !== id),
      selectedTrackId: state.selectedTrackId === id ? null : state.selectedTrackId,
      selectedClipId: state.arrangementClips.some(c => c.trackId === id && c.id === state.selectedClipId)
        ? null
        : state.selectedClipId,
    };
  }),

  setReferenceTrack: (id: string) => set((state) => ({
    // Master = default source-playback target only; grid BPM is set via PROJECT BPM or track USE
    tracks: state.tracks.map(t => ({ ...t, isReference: t.id === id })),
  })),

  updateTrack: (id: string, updates: Partial<AudioTrack>) => set((state) => ({
    tracks: state.tracks.map(t => t.id === id ? { ...t, ...updates } : t),
  })),

  // Toggle a mute region on a track. If a region with the same start/end
  // already exists, removes it; otherwise adds it. Used by StructureRibbon
  // to mute/unmute a detected section without creating arrangement clips.
  toggleSectionMute: (trackId: string, region: SectionMute) => set((state) => {
    PAST_STATES.push(state);
    return {
      tracks: state.tracks.map(t => {
        if (t.id !== trackId) return t;
        const existing = t.sectionMutes || [];
        const matchIdx = existing.findIndex(
          m => Math.abs(m.start - region.start) < 0.05
            && Math.abs(m.end - region.end) < 0.05,
        );
        const next = matchIdx >= 0
          ? existing.filter((_, i) => i !== matchIdx)
          : [...existing, region];
        return { ...t, sectionMutes: next };
      }),
    };
  }),

  addArrangementClip: (clip: Clip) => set((state) => {
    PAST_STATES.push(state);
    return { arrangementClips: [...state.arrangementClips, clip] };
  }),

  removeArrangementClip: (id: string) => set((state) => {
    PAST_STATES.push(state);
    return {
      arrangementClips: state.arrangementClips.filter(c => c.id !== id),
      selectedClipId: state.selectedClipId === id ? null : state.selectedClipId,
    };
  }),

  updateArrangementClip: (id: string, updates: Partial<Clip>) => set((state) => ({
    arrangementClips: state.arrangementClips.map(c => c.id === id ? { ...c, ...updates } : c),
  })),

  splitArrangementClip: (id: string, splitOffset: number) => set((state) => {
    const clip = state.arrangementClips.find(c => c.id === id);
    if (!clip) return state;

    const minDuration = 0.05;
    const safeOffset = Math.max(minDuration, Math.min(clip.sourceDuration - minDuration, splitOffset));
    if (!Number.isFinite(safeOffset) || safeOffset <= minDuration || safeOffset >= clip.sourceDuration - minDuration) {
      return state;
    }

    PAST_STATES.push(state);

    const leftClip: Clip = {
      ...clip,
      sourceDuration: safeOffset,
      fadeOut: Math.min(clip.fadeOut, safeOffset),
    };

    const rightDuration = clip.sourceDuration - safeOffset;
    const rightClip: Clip = {
      ...clip,
      id: crypto.randomUUID(),
      sourceStart: clip.sourceStart + safeOffset,
      sourceDuration: rightDuration,
      timelinePosition: clip.timelinePosition + safeOffset,
      slipOffset: 0,
      fadeIn: Math.min(clip.fadeIn, rightDuration),
      fadeOut: Math.min(clip.fadeOut, rightDuration),
      label: `${clip.label} / SPLIT`,
    };

    return {
      arrangementClips: state.arrangementClips.flatMap(c => c.id === id ? [leftClip, rightClip] : [c]),
      selectedClipId: rightClip.id,
      toolMode: 'select',
    };
  }),

  duplicateArrangementClip: (id: string) => set((state) => {
    const clip = state.arrangementClips.find(c => c.id === id);
    if (!clip) return state;
    PAST_STATES.push(state);
    return {
      arrangementClips: [...state.arrangementClips, {
        ...clip,
        id: crypto.randomUUID(),
        timelinePosition: clip.timelinePosition + clip.sourceDuration,
        label: `${clip.label} (copy)`,
      }],
    };
  }),

  selectClip: (id: string | null) => set({ selectedClipId: id }),
  selectTrack: (id: string | null) => set({ selectedTrackId: id }),

  setBpm: (bpm: number, source: BpmSource = 'manual') => set((state) => ({
    bpm,
    bpmSource: source,
    arrangementClips: reconformClipsToGrid(state.arrangementClips, state.tracks, bpm),
  })),

  setAppliedBpm: (bpm: number) => set({ appliedBpm: bpm }),

  setApplyingTempo: (v: boolean) => set({ isApplyingTempo: v }),

  setSegmentMode: (mode: SegmentMode) => set({ segmentMode: mode }),
  setZoom: (level: number) => set({ zoomLevel: Math.max(0.05, Math.min(20, level)) }),
  setScroll: (pos: number) => set({ scrollPosition: Math.max(0, pos) }),
  setPlaybackState: (state: PlaybackState) => set({ playbackState: state }),
  setPlayheadPosition: (pos: number) => set({ playheadPosition: pos }),
  setLoopRegion: (region: { start: number; end: number } | null) => set({ loopRegion: region }),
  setToolMode: (mode: ToolMode) => set({ toolMode: mode }),
  setSnapEnabled: (v: boolean) => set({ snapEnabled: v }),
  setSnapResolution: (r: SnapResolution) => set({ snapResolution: r }),
  setSnapGuidePosition: (pos: number | null) => set({ snapGuidePosition: pos }),
  setMetronomeEnabled: (enabled: boolean) => set({ metronomeEnabled: enabled }),

  triggerPlay: (fromPosition?: number) => set((state) => {
    const pos = fromPosition ?? state.playheadPosition;
    return {
      playheadPosition: pos,
      playbackState: 'playing',
      playTrigger: state.playTrigger + 1,
    };
  }),

  saveProject: async () => {
    const state = get();

    // Bundle each track's ORIGINAL file bytes (preserves the compressed
    // format — MP3 stays MP3 — minimizing project size vs re-encoding WAV).
    // Encoded as base64 inside the JSON so the .tethr file is a single
    // self-contained text artifact the user can move/share freely.
    const tracksOut = await Promise.all(state.tracks.map(async (track) => {
      const { file, audioBuffer, waveformData, ...meta } = track;
      let audioBase64: string | undefined;
      let audioMimeType: string | undefined;
      let audioByteLength: number | undefined;

      if (file) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          audioBase64 = arrayBufferToBase64(arrayBuffer);
          audioMimeType = file.type || 'audio/wav';
          audioByteLength = arrayBuffer.byteLength;
        } catch (err) {
          console.error('[TETHR] failed to read audio bytes for', track.name, err);
        }
      }

      return { ...meta, audioBase64, audioMimeType, audioByteLength };
    }));

    const project = {
      schemaVersion: 2,
      id: crypto.randomUUID(),
      name: state.projectName,
      bpm: state.bpm,
      bpmSource: state.bpmSource,
      timeSignatureNumerator: 4,
      timeSignatureDenominator: 4,
      tracks: tracksOut,
      arrangementClips: state.arrangementClips,
      zoomLevel: state.zoomLevel,
      scrollPosition: state.scrollPosition,
      segmentMode: state.segmentMode,
      metronomeEnabled: state.metronomeEnabled,
      snapEnabled: state.snapEnabled,
      snapResolution: state.snapResolution,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // No pretty-print — bundled audio makes pretty-print expensive and
    // pointless. The file is binary-in-text either way.
    const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.projectName}.tethr`;
    a.click();
    URL.revokeObjectURL(url);
  },

  loadProject: async (json: string) => {
    let project: any;
    try {
      project = JSON.parse(json);
    } catch (e) {
      console.error('[TETHR] failed to parse project JSON', e);
      throw new Error('Project file is invalid or corrupted.');
    }

    // Stop playback + reset transient state before swapping tracks under
    // the audio engine's feet.
    set({ playbackState: 'stopped', playheadPosition: 0 });

    const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

    try {
      const tracksOut: AudioTrack[] = [];
      for (const t of (project.tracks ?? [])) {
        // Schema v2: bundled audio bytes. Schema v1: skip track (no audio
        // was ever saved). Either way, never throw — partial load is better
        // than blocked load.
        if (!t.audioBase64) {
          console.warn('[TETHR] track', t.name, 'has no bundled audio (legacy schema); skipping');
          continue;
        }

        let audioBuffer: AudioBuffer | null = null;
        let waveformData: Float32Array | null = null;
        let file: File;

        try {
          const bytes = base64ToArrayBuffer(t.audioBase64);
          file = new File([bytes], t.fileName || 'audio', {
            type: t.audioMimeType || 'audio/wav',
          });
          // decodeAudioData neuters its input — pass a fresh copy.
          audioBuffer = await decodeCtx.decodeAudioData(bytes.slice(0));
          waveformData = generateWaveformPeaks(audioBuffer);
        } catch (err) {
          console.error('[TETHR] failed to decode audio for', t.name, err);
          continue;
        }

        tracksOut.push({
          id: t.id || crypto.randomUUID(),
          name: t.name || 'Untitled',
          file,
          fileName: t.fileName || 'audio',
          duration: t.duration ?? audioBuffer.duration,
          sampleRate: t.sampleRate ?? audioBuffer.sampleRate,
          channelCount: t.channelCount ?? audioBuffer.numberOfChannels,
          audioBuffer,
          waveformData,
          color: t.color || COLORS[tracksOut.length % COLORS.length],
          isReference: t.isReference ?? (tracksOut.length === 0),
          isMuted: t.isMuted ?? false,
          volume: typeof t.volume === 'number' ? t.volume : 1.0,
          estimatedBpm: t.estimatedBpm ?? null,
          bpmConfidence: t.bpmConfidence ?? 0,
          beatCorrectionMap: t.beatCorrectionMap ?? detectBeatCorrectionMap(audioBuffer, t.estimatedBpm ?? project.bpm ?? 120),
          structureSegments: t.structureSegments ?? [],
          sectionMutes: t.sectionMutes ?? [],
        });
      }

      // Current TETHR workflow is intentionally single-track. Legacy project
      // files may contain extra tracks/clips; loading normalizes the session
      // back to one active corrected track without mutating the source file.
      const activeTracks = tracksOut.slice(0, 1).map((t, i) => ({
        ...t,
        isReference: i === 0,
      }));
      const activeTrack = activeTracks[0] ?? null;
      const loadedBpm = project.bpm ?? activeTrack?.estimatedBpm ?? 120;

      set({
        projectName: project.name || 'Untitled Project',
        bpm: loadedBpm,
        // Sync appliedBpm so the APPLY TEMPO button doesn't spuriously
        // appear immediately after a load.
        appliedBpm: loadedBpm,
        bpmSource: project.bpmSource ?? 'manual',
        tracks: activeTracks,
        arrangementClips: [],
        segmentMode: project.segmentMode ?? 8,
        zoomLevel: project.zoomLevel ?? 1,
        scrollPosition: project.scrollPosition ?? 0,
        metronomeEnabled: project.metronomeEnabled ?? false,
        snapEnabled: project.snapEnabled ?? true,
        snapResolution: project.snapResolution ?? 'bar',
        selectedClipId: null,
        selectedTrackId: activeTrack?.id ?? null,
        playheadPosition: 0,
        playbackState: 'stopped',
      });
    } finally {
      decodeCtx.close().catch(() => {});
    }
  },

  undo: () => set((state) => {
    if (PAST_STATES.length === 0) return state;
    const previous = PAST_STATES.pop();
    FUTURE_STATES.push(state);
    return previous;
  }),

  redo: () => set((state) => {
    if (FUTURE_STATES.length === 0) return state;
    const next = FUTURE_STATES.pop();
    PAST_STATES.push(state);
    return next;
  }),
}));
