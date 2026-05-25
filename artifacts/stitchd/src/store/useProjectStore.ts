import { create } from 'zustand';
import { AudioTrack, Clip, PlaybackState, SegmentMode, ToolMode, BpmSource, SnapResolution } from '../types/audio';
import { conformTempoRatio, clearStretchCacheForTrack } from '../lib/timeStretch';

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
  saveProject: () => void;
  loadProject: (json: string) => void;
  undo: () => void;
  redo: () => void;
}

const PAST_STATES: any[] = [];
const FUTURE_STATES: any[] = [];

const COLORS = [
  'hsl(186 90% 62% / 0.85)',  // signal cyan — accent track
  'hsl(232 85% 72% / 0.80)',  // periwinkle midpoint
  'hsl(255 75% 68% / 0.75)',  // deep violet
  'hsl(271 70% 70% / 0.70)',  // cool magenta-violet
  'hsl(220 35% 58% / 0.65)',  // neutral lane
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
        `[STITCHD import] "${file.name}" | duration: ${durMin}:${durSec} | BPM: ${detectedBpm} | confidence: ${Math.round(confidence * 100)}% | method: energy-autocorrelation`
      );
    } else {
      console.log(
        `[STITCHD import] "${file.name}" | duration: ${durMin}:${durSec} | BPM: unknown | confidence: ${Math.round(confidence * 100)}% | fallback: manual entry required`
      );
    }

    // Waveform peaks (2000 points for display)
    const channelData = audioBuffer.getChannelData(0);
    const peakCount = 2000;
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

    const isFirstTrack = get().tracks.length === 0;

    const newTrack: AudioTrack = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^/.]+$/, ''),
      file,
      fileName: file.name,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      channelCount: audioBuffer.numberOfChannels,
      audioBuffer,
      waveformData: peaks,
      color: COLORS[get().tracks.length % COLORS.length],
      isReference: isFirstTrack,
      isMuted: false,
      volume: 1.0,
      estimatedBpm: detectedBpm,
      bpmConfidence: confidence,
    };

    set((state) => {
      PAST_STATES.push(state);
      // First import: apply detected tempo to project grid only (per-track estimatedBpm stays separate)
      const applyDetectedToGrid = isFirstTrack && detectedBpm !== null;

      // Auto-fit zoom on FIRST import only — fits the full song into the
      // viewport with ~10% horizontal breathing room. Subsequent imports
      // preserve the user's current zoom. Matches Timeline's
      // baseVisibleDuration = 30 (zoom=1 → 30s visible).
      let nextZoom = state.zoomLevel;
      if (isFirstTrack && audioBuffer.duration > 0) {
        const BASE_VISIBLE_DURATION = 30;
        const targetVisible = audioBuffer.duration * 1.1;
        nextZoom = Math.max(0.05, Math.min(20, BASE_VISIBLE_DURATION / targetVisible));
      }

      return {
        tracks: [...state.tracks, newTrack],
        bpm: applyDetectedToGrid ? detectedBpm : state.bpm,
        bpmSource: applyDetectedToGrid ? 'auto' : state.bpmSource,
        zoomLevel: nextZoom,
      };
    });
  },

  removeTrack: (id: string) => set((state) => {
    PAST_STATES.push(state);
    clearStretchCacheForTrack(id);
    return {
      tracks: state.tracks.filter(t => t.id !== id),
      arrangementClips: state.arrangementClips.filter(c => c.trackId !== id),
    };
  }),

  setReferenceTrack: (id: string) => set((state) => ({
    // Master = default source-playback target only; grid BPM is set via PROJECT BPM or track USE
    tracks: state.tracks.map(t => ({ ...t, isReference: t.id === id })),
  })),

  updateTrack: (id: string, updates: Partial<AudioTrack>) => set((state) => ({
    tracks: state.tracks.map(t => t.id === id ? { ...t, ...updates } : t),
  })),

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

  saveProject: () => {
    const state = get();
    const project = {
      id: crypto.randomUUID(),
      name: state.projectName,
      bpm: state.bpm,
      bpmSource: state.bpmSource,
      timeSignatureNumerator: 4,
      timeSignatureDenominator: 4,
      tracks: state.tracks.map(({ file, audioBuffer, waveformData, ...t }) => t),
      clips: [],
      arrangementClips: state.arrangementClips,
      warpMarkers: [],
      zoomLevel: state.zoomLevel,
      scrollPosition: state.scrollPosition,
      segmentMode: state.segmentMode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.projectName}.stitchd`;
    a.click();
    URL.revokeObjectURL(url);
  },

  loadProject: (json: string) => {
    try {
      const project = JSON.parse(json);
      set({
        projectName: project.name,
        bpm: project.bpm ?? 120,
        bpmSource: project.bpmSource ?? 'manual',
        arrangementClips: project.arrangementClips ?? [],
        segmentMode: project.segmentMode ?? 8,
        zoomLevel: project.zoomLevel ?? 1,
        scrollPosition: project.scrollPosition ?? 0,
      });
      alert('Project loaded. Please re-import the original audio files to restore full playback.');
    } catch (e) {
      console.error('Failed to load project', e);
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
