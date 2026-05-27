import { useEffect, useRef, useCallback } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import {
  createMetronomeBuffers,
  scheduleMetronomeClicks,
  stopMetronomeSources,
  type MetronomeBuffers,
} from '../lib/metronome';
import {
  conformTempoRatio,
  getTimeStretchedSlice,
  stretchedTimelineDuration,
} from '../lib/timeStretch';
import {
  beatCorrectedDuration,
  getBeatCorrectedBuffer,
  sourceTimeToCorrectedTime,
} from '../lib/beatCorrection';

// ---------------------------------------------------------------------------
// Module-level meter analysers — read by LevelMeter without prop drilling
// ---------------------------------------------------------------------------
export const meterAnalysers: { left: AnalyserNode | null; right: AnalyserNode | null } = {
  left: null,
  right: null,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ANTI_CLICK_MS  = 0.004;  // 4ms ramp-in on every new source to prevent pops
const SOFT_STOP_MS   = 0.020;  // 20ms ramp-down when user presses Stop/Pause
const LOOP_XFADE_MS  = 0.010;  // 10ms crossfade ramp when restarting (loop / re-play)
const METRONOME_SCHEDULE_AHEAD_SEC = 120;
const METRONOME_EXTEND_THRESHOLD_SEC = 30;
const METRONOME_GAIN = 0.52;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type FadeCurve = 'linear' | 'equal-power' | 's-curve';

function scheduleFadeIn(
  gain: AudioParam,
  curve: FadeCurve,
  startTime: number,
  duration: number,
  targetGain: number,
) {
  if (duration <= 0) {
    gain.setValueAtTime(targetGain, startTime);
    return;
  }
  if (curve === 'equal-power') {
    gain.setValueAtTime(0.0001, startTime);
    gain.exponentialRampToValueAtTime(targetGain, startTime + duration);
  } else {
    gain.setValueAtTime(0, startTime);
    gain.linearRampToValueAtTime(targetGain, startTime + duration);
  }
}

function scheduleFadeOut(
  gain: AudioParam,
  curve: FadeCurve,
  startTime: number,
  duration: number,
  fromGain: number,
) {
  if (duration <= 0) return;
  const endTime = startTime + duration;
  if (curve === 'equal-power') {
    gain.setValueAtTime(fromGain, startTime);
    gain.exponentialRampToValueAtTime(0.0001, endTime);
    gain.setValueAtTime(0, endTime);
  } else {
    gain.setValueAtTime(fromGain, startTime);
    gain.linearRampToValueAtTime(0, endTime);
  }
}

// Compute scaled fade durations so they never overlap (same logic used in export)
function safeScaledFades(fadeIn: number, fadeOut: number, outDuration: number) {
  const total = fadeIn + fadeOut;
  const scale = total > 0 && total > outDuration ? outDuration / total : 1.0;
  return { safeFadeIn: fadeIn * scale, safeFadeOut: fadeOut * scale };
}

// ---------------------------------------------------------------------------
// Standalone WAV render — callable from anywhere, no hook needed
// ---------------------------------------------------------------------------
export async function renderArrangement(sampleRate: number = 44100): Promise<Blob> {
  const { arrangementClips, tracks, bpm, selectedTrackId } = useProjectStore.getState();

  // No arrangement clips → render the source-conformed reference track.
  // Previously this returned an empty Blob and silently failed export.
  // Users should be able to import → tempo-adjust → export without ever
  // creating clips.
  if (arrangementClips.length === 0) {
    const sourceTrack =
      tracks.find(t => t.id === selectedTrackId) ||
      tracks.find(t => t.isReference) ||
      tracks[0];
    if (!sourceTrack || !sourceTrack.audioBuffer || sourceTrack.isMuted) {
      return new Blob([], { type: 'audio/wav' });
    }

    let buffer = sourceTrack.audioBuffer;

    // Resample to target sampleRate if needed
    if (buffer.sampleRate !== sampleRate) {
      const resCtx = new OfflineAudioContext(
        buffer.numberOfChannels,
        Math.ceil(buffer.duration * sampleRate),
        sampleRate,
      );
      const s = resCtx.createBufferSource();
      s.buffer = buffer;
      s.connect(resCtx.destination);
      s.start(0);
      buffer = await resCtx.startRendering();
    }

    const ratio = conformTempoRatio(sourceTrack.estimatedBpm, bpm);
    const correctedDuration = beatCorrectedDuration(sourceTrack.beatCorrectionMap, bpm, buffer.duration);
    const fallbackDuration = buffer.duration / Math.max(0.05, ratio);
    const offlineCtx = new OfflineAudioContext(
      2,
      Math.ceil(sampleRate * ((sourceTrack.beatCorrectionMap ? correctedDuration : fallbackDuration) + 0.25)),
      sampleRate,
    );

    let beatCorrected: AudioBuffer | null = null;
    try {
      beatCorrected = await getBeatCorrectedBuffer(
        offlineCtx,
        sourceTrack.id,
        buffer,
        sourceTrack.beatCorrectionMap,
        bpm,
      );
    } catch (err) {
      console.error('[TETHR] export beat-map correction failed; falling back to global conform', err);
    }

    const stretched = beatCorrected ?? await getTimeStretchedSlice(
      offlineCtx,
      sourceTrack.id,
      buffer,
      0,
      buffer.duration,
      ratio,
    );

    // Apply mute regions (sectionMutes) by automating gain at segment edges
    const mutes = sourceTrack.sectionMutes || [];
    const masterGain = offlineCtx.createGain();
    masterGain.connect(offlineCtx.destination);

    const trackVol = Math.max(0, sourceTrack.volume);
    masterGain.gain.setValueAtTime(trackVol, 0);

    // Mute regions are in SOURCE seconds; convert to corrected OUTPUT time.
    for (const m of mutes) {
      const outStart = beatCorrected
        ? sourceTimeToCorrectedTime(sourceTrack.beatCorrectionMap, m.start, bpm)
        : m.start / Math.max(0.05, ratio);
      const outEnd = beatCorrected
        ? sourceTimeToCorrectedTime(sourceTrack.beatCorrectionMap, m.end, bpm)
        : m.end / Math.max(0.05, ratio);
      // Quick fade out → silence → fade back. Avoids clicks.
      const fade = 0.008;
      try {
        masterGain.gain.setValueAtTime(trackVol, Math.max(0, outStart - fade));
        masterGain.gain.linearRampToValueAtTime(0, outStart);
        masterGain.gain.setValueAtTime(0, outEnd);
        masterGain.gain.linearRampToValueAtTime(trackVol, outEnd + fade);
      } catch (_) {}
    }

    const src = offlineCtx.createBufferSource();
    src.buffer = stretched;
    src.connect(masterGain);
    src.start(0);

    const rendered = await offlineCtx.startRendering();
    return encodeWAV(rendered, sampleRate);
  }

  let maxTime = 0;
  arrangementClips.forEach(c => {
    const nudgeSec = (c.nudgeOffset || 0) / 1000;
    const outDuration = stretchedTimelineDuration(c.sourceDuration, c.stretchRatio || 1.0);
    const end = c.timelinePosition + nudgeSec + outDuration;
    if (end > maxTime) maxTime = end;
  });
  if (maxTime <= 0) return new Blob([], { type: 'audio/wav' });

  const totalDuration = maxTime + 0.5;
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDuration), sampleRate);

  const masterGain = offlineCtx.createGain();
  masterGain.gain.value = 1.0;
  masterGain.connect(offlineCtx.destination);

  for (const clip of arrangementClips) {
    const track = tracks.find(t => t.id === clip.trackId);
    if (!track || !track.audioBuffer || track.isMuted) continue;

    const nudgeSec = (clip.nudgeOffset || 0) / 1000;
    const effectiveStart = Math.max(0, clip.timelinePosition + nudgeSec);
    const stretchR = Math.max(0.05, clip.stretchRatio || 1.0);
    const srcStart = clip.sourceStart + (clip.slipOffset || 0);

    let buffer = track.audioBuffer;
    if (buffer.sampleRate !== sampleRate) {
      const resCtx = new OfflineAudioContext(
        buffer.numberOfChannels,
        Math.ceil(buffer.duration * sampleRate),
        sampleRate,
      );
      const s = resCtx.createBufferSource();
      s.buffer = buffer;
      s.connect(resCtx.destination);
      s.start(0);
      buffer = await resCtx.startRendering();
    }

    const playBuffer = await getTimeStretchedSlice(
      offlineCtx,
      track.id,
      buffer,
      srcStart,
      clip.sourceDuration,
      stretchR,
    );

    const outDuration = playBuffer.duration;
    const effectiveEnd = effectiveStart + outDuration;

    const gainNode = offlineCtx.createGain();
    gainNode.connect(masterGain);
    const targetGain = Math.max(0, clip.gain) * Math.max(0, track.volume);
    const fadeCurve: FadeCurve = (clip.fadeCurve as FadeCurve) || 'equal-power';

    const { safeFadeIn, safeFadeOut } = safeScaledFades(clip.fadeIn || 0, clip.fadeOut || 0, outDuration);

    gainNode.gain.setValueAtTime(0, effectiveStart);
    if (safeFadeIn > 0) {
      scheduleFadeIn(gainNode.gain, fadeCurve, effectiveStart, safeFadeIn, targetGain);
    } else {
      gainNode.gain.setValueAtTime(targetGain, effectiveStart);
    }

    if (safeFadeOut > 0) {
      const foStart = Math.max(effectiveStart, effectiveEnd - safeFadeOut);
      scheduleFadeOut(gainNode.gain, fadeCurve, foStart, safeFadeOut, targetGain);
    }

    const source = offlineCtx.createBufferSource();
    source.buffer = playBuffer;
    source.connect(gainNode);
    source.start(effectiveStart, 0, outDuration);
  }

  const rendered = await offlineCtx.startRendering();
  return encodeWAV(rendered, sampleRate);
}

function encodeWAV(buffer: AudioBuffer, sampleRate: number): Blob {
  const numCh = buffer.numberOfChannels;
  const numSamples = buffer.length;
  const blockAlign = numCh * 2;
  const dataSize = numSamples * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const ws = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ws(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ws(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// Per-clip/source gain nodes — updated live when track volume or clip gain changes
type ScheduledGain = {
  trackId: string;
  clipId: string | null;
  gainNode: GainNode;
  clipGain: number;
};

function trackEffectiveVolume(track: { volume: number; isMuted: boolean }): number {
  return track.isMuted ? 0 : Math.max(0, track.volume);
}

function applyLiveGain(ctx: AudioContext, gainNode: GainNode, clipGain: number, trackVolume: number) {
  const target = Math.max(0, clipGain) * trackVolume;
  try {
    gainNode.gain.cancelScheduledValues(ctx.currentTime);
    gainNode.gain.setValueAtTime(target, ctx.currentTime);
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Hook — manages the live AudioContext for playback only
// ---------------------------------------------------------------------------
export function useAudioEngine() {
  const contextRef     = useRef<AudioContext | null>(null);
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainNodesRef   = useRef<AudioNode[]>([]);
  const scheduledGainsRef = useRef<ScheduledGain[]>([]);
  const startOffsetRef = useRef<number>(0);
  const startTimeRef   = useRef<number>(0);
  const animFrameRef   = useRef<number>(0);
  const isPlayingRef   = useRef<boolean>(false);
  // End time (ctx time) for source-only playback — used by tick loop for auto-stop
  const sourceEndCtxRef = useRef<number>(0);
  const metronomeBuffersRef = useRef<MetronomeBuffers | null>(null);
  const metronomeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const metronomeGainRef = useRef<GainNode | null>(null);
  const metronomeScheduledUntilRef = useRef<number>(0);
  const playbackGenRef = useRef(0);

  const playbackState = useProjectStore(s => s.playbackState);
  const playTrigger   = useProjectStore(s => s.playTrigger);

  const getCtx = (): AudioContext => {
    if (!contextRef.current || contextRef.current.state === 'closed') {
      contextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      metronomeBuffersRef.current = null;
    }
    return contextRef.current;
  };

  const ensureMetronomeBuffers = useCallback((ctx: AudioContext): MetronomeBuffers => {
    if (!metronomeBuffersRef.current) {
      metronomeBuffersRef.current = createMetronomeBuffers(ctx);
    }
    return metronomeBuffersRef.current;
  }, []);

  const stopMetronome = useCallback(() => {
    const ctx = contextRef.current;
    stopMetronomeSources(metronomeSourcesRef.current, ctx);
    metronomeSourcesRef.current = [];
    metronomeScheduledUntilRef.current = 0;
    if (metronomeGainRef.current) {
      try {
        metronomeGainRef.current.disconnect();
      } catch (_) {}
      metronomeGainRef.current = null;
    }
  }, []);

  const getContentEndTimeline = useCallback((): number => {
    const { arrangementClips, tracks, bpm } = useProjectStore.getState();
    if (arrangementClips.length > 0) {
      return Math.max(
        ...arrangementClips.map(c => {
          const r = Math.max(0.05, c.stretchRatio || 1.0);
          return c.timelinePosition + (c.nudgeOffset || 0) / 1000 + stretchedTimelineDuration(c.sourceDuration, r);
        }),
      );
    }
    if (tracks.length > 0) {
      return Math.max(...tracks.map(t =>
        beatCorrectedDuration(t.beatCorrectionMap, bpm, t.audioBuffer?.duration ?? t.duration),
      ));
    }
    return 0;
  }, []);

  const scheduleMetronome = useCallback((
    ctx: AudioContext,
    timelineStart: number,
    ctxAnchorTime: number,
    scheduleUntilTimeline?: number,
  ) => {
    const { metronomeEnabled, bpm } = useProjectStore.getState();
    if (!metronomeEnabled || bpm <= 0) return;

    const buffers = ensureMetronomeBuffers(ctx);
    if (!metronomeGainRef.current) {
      const g = ctx.createGain();
      g.gain.value = METRONOME_GAIN;
      g.connect(ctx.destination);
      metronomeGainRef.current = g;
    }

    const contentEnd = getContentEndTimeline();
    const until = scheduleUntilTimeline ?? Math.max(
      timelineStart + METRONOME_SCHEDULE_AHEAD_SEC,
      contentEnd + 2,
    );

    const fromTimeline = Math.max(0, Math.max(timelineStart, metronomeScheduledUntilRef.current));
    if (until <= fromTimeline + 1e-4) return;

    const added = scheduleMetronomeClicks(ctx, metronomeGainRef.current, buffers, {
      bpm,
      timelineStart: fromTimeline,
      ctxAnchorTime,
      scheduleUntilTimeline: until,
    });
    metronomeSourcesRef.current.push(...added);
    metronomeScheduledUntilRef.current = until;
  }, [ensureMetronomeBuffers, getContentEndTimeline]);

  const resyncMetronomeFromPlayhead = useCallback(() => {
    const ctx = contextRef.current;
    if (!ctx || ctx.state === 'closed' || !isPlayingRef.current) return;
    const { metronomeEnabled } = useProjectStore.getState();
    if (!metronomeEnabled) return;

    stopMetronome();
    const timelinePos = startOffsetRef.current + (ctx.currentTime - startTimeRef.current);
    scheduleMetronome(ctx, timelinePos, ctx.currentTime);
  }, [scheduleMetronome, stopMetronome]);

  // Hard stop — immediate, used internally before starting new playback
  const stopAllSources = useCallback(() => {
    playbackGenRef.current += 1;
    stopMetronome();
    sourceNodesRef.current.forEach(n => {
      try { n.stop(0); } catch (_) {}
      try { n.disconnect(); } catch (_) {}
    });
    gainNodesRef.current.forEach(n => { try { n.disconnect(); } catch (_) {} });
    sourceNodesRef.current = [];
    gainNodesRef.current   = [];
    scheduledGainsRef.current = [];
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    isPlayingRef.current = false;
    meterAnalysers.left  = null;
    meterAnalysers.right = null;
  }, [stopMetronome]);

  // Soft stop — ramps gain to 0 over SOFT_STOP_MS then hard-stops.
  // Used for UI-triggered Stop / Pause to eliminate audible pops.
  const softStopSources = useCallback(() => {
    playbackGenRef.current += 1;
    stopMetronome();
    // Stop the tick loop immediately so the UI shows the stopped state right away
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    isPlayingRef.current = false;
    meterAnalysers.left  = null;
    meterAnalysers.right = null;

    const ctx = contextRef.current;
    const toStop       = [...sourceNodesRef.current];
    const toDisconnect = [...gainNodesRef.current];
    sourceNodesRef.current = [];
    gainNodesRef.current   = [];
    scheduledGainsRef.current = [];

    if (!ctx || ctx.state === 'closed') {
      toStop.forEach(n => { try { n.stop(0); n.disconnect(); } catch (_) {} });
      toDisconnect.forEach(n => { try { n.disconnect(); } catch (_) {} });
      return;
    }

    // Ramp all gain nodes to silence
    toDisconnect.forEach(n => {
      if (n instanceof GainNode) {
        try {
          n.gain.cancelScheduledValues(ctx.currentTime);
          n.gain.setValueAtTime(n.gain.value, ctx.currentTime);
          n.gain.linearRampToValueAtTime(0, ctx.currentTime + SOFT_STOP_MS);
        } catch (_) {}
      }
    });

    // Hard-stop sources after the ramp completes
    const delay = Math.ceil(SOFT_STOP_MS * 1000) + 15;
    setTimeout(() => {
      toStop.forEach(n => { try { n.stop(0); n.disconnect(); } catch (_) {} });
      toDisconnect.forEach(n => { try { n.disconnect(); } catch (_) {} });
    }, delay);
  }, []);

  const schedulePlayback = useCallback(async (startOffset: number) => {
    const gen = ++playbackGenRef.current;
    const ctx = getCtx();
    const {
      arrangementClips,
      tracks,
      selectedTrackId,
      setPlayheadPosition,
      setPlaybackState,
      setAppliedBpm,
      setApplyingTempo,
      metronomeEnabled,
      bpm,
    } = useProjectStore.getState();

    // Mark this BPM as the one audio is being rendered at — drives the
    // "APPLY TEMPO" button in the Transport. Called early so the button
    // hides as soon as the user commits the reschedule, even though the
    // stretch may still be in flight for a moment.
    setAppliedBpm(bpm);

    try {

    stopMetronome();

    // Crossfade existing sources out (prevents pop when looping / re-playing)
    const prevSources = [...sourceNodesRef.current];
    const prevGains   = [...gainNodesRef.current];
    if (prevSources.length > 0 || prevGains.length > 0) {
      prevGains.forEach(n => {
        if (n instanceof GainNode) {
          try {
            n.gain.cancelScheduledValues(ctx.currentTime);
            n.gain.setValueAtTime(n.gain.value, ctx.currentTime);
            n.gain.linearRampToValueAtTime(0, ctx.currentTime + LOOP_XFADE_MS);
          } catch (_) {}
        }
      });
      setTimeout(() => {
        prevSources.forEach(n => { try { n.stop(0); n.disconnect(); } catch (_) {} });
        prevGains.forEach(n => { try { n.disconnect(); } catch (_) {} });
      }, Math.ceil(LOOP_XFADE_MS * 1000) + 10);
    }
    sourceNodesRef.current = [];
    gainNodesRef.current   = [];
    scheduledGainsRef.current = [];

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }

    if (ctx.state === 'suspended') ctx.resume();

    startOffsetRef.current  = startOffset;
    startTimeRef.current    = ctx.currentTime;
    isPlayingRef.current    = true;
    sourceEndCtxRef.current = 0;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(ctx.destination);
    gainNodesRef.current.push(masterGain);

    // Stereo metering tap
    try {
      const splitter = ctx.createChannelSplitter(2);
      masterGain.connect(splitter);
      const aL = ctx.createAnalyser();
      aL.fftSize = 1024; aL.smoothingTimeConstant = 0;
      splitter.connect(aL, 0);
      const aR = ctx.createAnalyser();
      aR.fftSize = 1024; aR.smoothingTimeConstant = 0;
      splitter.connect(aR, 1);
      meterAnalysers.left  = aL;
      meterAnalysers.right = aR;
    } catch (_) {}

    const hasClips = arrangementClips.length > 0;

    if (!hasClips) {
      // -------------------------------------------------------------------
      // SOURCE-ONLY mode — play the focused track tempo-corrected so users
      // hear the full song conformed to the grid BPM immediately after
      // import, before any arrangement exists. Pitch-preserving via the
      // same SoundTouch path used by arrangement clips.
      // Priority: selectedTrackId → reference track → first track.
      // -------------------------------------------------------------------
      const sourceTrack =
        tracks.find(t => t.id === selectedTrackId) ||
        tracks.find(t => t.isReference) ||
        tracks[0];

      if (!sourceTrack || !sourceTrack.audioBuffer || sourceTrack.isMuted) {
        stopAllSources();
        setPlaybackState('stopped');
        return;
      }

      const ratio = conformTempoRatio(sourceTrack.estimatedBpm, bpm);

      let playBuffer: AudioBuffer | null = null;
      let usingBeatCorrection = false;
      try {
        const corrected = await getBeatCorrectedBuffer(
          ctx,
          sourceTrack.id,
          sourceTrack.audioBuffer,
          sourceTrack.beatCorrectionMap,
          bpm,
        );
        if (corrected) {
          playBuffer = corrected;
          usingBeatCorrection = true;
        } else {
          playBuffer = await getTimeStretchedSlice(
            ctx,
            sourceTrack.id,
            sourceTrack.audioBuffer,
            0,
            sourceTrack.audioBuffer.duration,
            ratio,
          );
        }
      } catch (err) {
        console.error('[TETHR] beat-map tempo correction failed', err);
        try {
          playBuffer = await getTimeStretchedSlice(
            ctx,
            sourceTrack.id,
            sourceTrack.audioBuffer,
            0,
            sourceTrack.audioBuffer.duration,
            ratio,
          );
        } catch (fallbackErr) {
          console.error('[TETHR] source-mode tempo conform failed', fallbackErr);
          stopAllSources();
          setPlaybackState('stopped');
          return;
        }
      }

      if (!playBuffer) {
        console.error('[TETHR] no corrected playback buffer available');
        stopAllSources();
        setPlaybackState('stopped');
        return;
      }

      // Bail if a newer playback generation started while we were stretching
      if (gen !== playbackGenRef.current) return;

      // Timeline maps 1:1 to the stretched buffer in source mode
      const cStart = Math.max(0, Math.min(playBuffer.duration - 0.001, startOffset));
      const cDur   = Math.max(0, playBuffer.duration - cStart);
      if (cDur <= 0) { stopAllSources(); setPlaybackState('stopped'); return; }

      const gainNode = ctx.createGain();
      // Anti-click ramp-in
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(
        Math.max(0, sourceTrack.volume),
        ctx.currentTime + ANTI_CLICK_MS,
      );
      // Anti-click ramp-out just before the source ends
      const srcEndCtx = ctx.currentTime + cDur;
      gainNode.gain.setValueAtTime(
        Math.max(0, sourceTrack.volume),
        Math.max(ctx.currentTime + ANTI_CLICK_MS, srcEndCtx - ANTI_CLICK_MS),
      );
      gainNode.gain.linearRampToValueAtTime(0, srcEndCtx);

      gainNode.connect(masterGain);
      gainNodesRef.current.push(gainNode);
      scheduledGainsRef.current.push({
        trackId: sourceTrack.id,
        clipId: null,
        gainNode,
        clipGain: 1,
      });

      const source  = ctx.createBufferSource();
      source.buffer = playBuffer;
      source.connect(gainNode);
      sourceNodesRef.current.push(source);
      source.start(ctx.currentTime, cStart, cDur);

      // Honor sectionMutes — automate the gain to drop to 0 across muted
      // regions (in corrected OUTPUT seconds). The
      // anti-click envelope above gives us the baseline; we punch holes.
      const mutes = sourceTrack.sectionMutes || [];
      if (mutes.length > 0) {
        const trackVol = Math.max(0, sourceTrack.volume);
        const fade = 0.008;
        for (const m of mutes) {
          const outStart = usingBeatCorrection
            ? sourceTimeToCorrectedTime(sourceTrack.beatCorrectionMap, m.start, bpm)
            : m.start / Math.max(0.05, ratio);
          const outEnd = usingBeatCorrection
            ? sourceTimeToCorrectedTime(sourceTrack.beatCorrectionMap, m.end, bpm)
            : m.end / Math.max(0.05, ratio);
          // Only schedule if the mute region overlaps the playing window.
          if (outEnd <= cStart || outStart >= cStart + cDur) continue;
          const muteStartCtx = ctx.currentTime + Math.max(0, outStart - cStart);
          const muteEndCtx   = ctx.currentTime + Math.max(0, outEnd   - cStart);
          try {
            gainNode.gain.setValueAtTime(trackVol, Math.max(ctx.currentTime, muteStartCtx - fade));
            gainNode.gain.linearRampToValueAtTime(0, muteStartCtx);
            gainNode.gain.setValueAtTime(0, muteEndCtx);
            gainNode.gain.linearRampToValueAtTime(trackVol, muteEndCtx + fade);
          } catch (_) {}
        }
      }

      // Store absolute ctx time when this source ends so the tick loop can auto-stop
      sourceEndCtxRef.current = srcEndCtx;

    } else {
      // -------------------------------------------------------------------
      // ARRANGEMENT mode — pitch-preserving stretch via SoundTouch, then schedule
      // -------------------------------------------------------------------
      for (const clip of arrangementClips) {
        const track = tracks.find(t => t.id === clip.trackId);
        if (!track || !track.audioBuffer || track.isMuted) continue;

        const nudgeSec   = (clip.nudgeOffset || 0) / 1000;
        const effStart   = clip.timelinePosition + nudgeSec;
        const stretchR   = Math.max(0.05, clip.stretchRatio || 1.0);
        const srcStart   = clip.sourceStart + (clip.slipOffset || 0);

        let playBuffer: AudioBuffer;
        try {
          playBuffer = await getTimeStretchedSlice(
            ctx,
            track.id,
            track.audioBuffer,
            srcStart,
            clip.sourceDuration,
            stretchR,
          );
        } catch (err) {
          console.error('[TETHR] time-stretch failed for clip', clip.id, err);
          continue;
        }

        if (gen !== playbackGenRef.current) return;

        const outDuration = playBuffer.duration;
        const effEnd     = effStart + outDuration;

        if (effEnd <= startOffset) continue;

        const gainNode = ctx.createGain();
        gainNodesRef.current.push(gainNode);
        gainNode.connect(masterGain);
        scheduledGainsRef.current.push({
          trackId: track.id,
          clipId: clip.id,
          gainNode,
          clipGain: clip.gain,
        });

        const targetGain = Math.max(0, clip.gain) * Math.max(0, track.volume);
        const fadeCurve: FadeCurve = (clip.fadeCurve as FadeCurve) || 'equal-power';

        const { safeFadeIn, safeFadeOut } = safeScaledFades(
          clip.fadeIn || 0,
          clip.fadeOut || 0,
          outDuration,
        );

        const clipWhen    = ctx.currentTime + Math.max(0, effStart - startOffset);
        const clipEndWhen = ctx.currentTime + Math.max(0, effEnd - startOffset);

        if (effStart >= startOffset) {
          if (safeFadeIn > 0) {
            scheduleFadeIn(gainNode.gain, fadeCurve, clipWhen, safeFadeIn, targetGain);
          } else {
            gainNode.gain.setValueAtTime(0, clipWhen);
            gainNode.gain.linearRampToValueAtTime(targetGain, clipWhen + ANTI_CLICK_MS);
          }
        } else {
          gainNode.gain.setValueAtTime(0, ctx.currentTime);
          gainNode.gain.linearRampToValueAtTime(targetGain, ctx.currentTime + ANTI_CLICK_MS);
        }

        if (safeFadeOut > 0) {
          const foStartWhen = clipEndWhen - safeFadeOut;
          if (foStartWhen > ctx.currentTime + ANTI_CLICK_MS) {
            scheduleFadeOut(gainNode.gain, fadeCurve, foStartWhen, safeFadeOut, targetGain);
          } else if (clipEndWhen > ctx.currentTime + ANTI_CLICK_MS) {
            const elapsed  = ctx.currentTime - foStartWhen;
            const remaining = safeFadeOut - Math.max(0, elapsed);
            if (remaining > 0.003) {
              const progress  = Math.min(1, Math.max(0, elapsed) / safeFadeOut);
              const fromGain  = Math.max(0.0001, targetGain * (1 - progress));
              scheduleFadeOut(gainNode.gain, fadeCurve, ctx.currentTime + ANTI_CLICK_MS, remaining, fromGain);
            } else {
              gainNode.gain.setValueAtTime(0, ctx.currentTime);
            }
          }
        } else {
          gainNode.gain.setValueAtTime(targetGain, Math.max(ctx.currentTime + ANTI_CLICK_MS, clipEndWhen - ANTI_CLICK_MS));
          gainNode.gain.linearRampToValueAtTime(0, clipEndWhen);
        }

        const source = ctx.createBufferSource();
        source.buffer = playBuffer;
        source.playbackRate.value = 1;
        source.connect(gainNode);
        sourceNodesRef.current.push(source);

        let readOffset = 0;
        let schedWhen = clipWhen;

        if (effStart < startOffset) {
          readOffset = startOffset - effStart;
          schedWhen  = ctx.currentTime;
        }

        const cDur = Math.max(0, playBuffer.duration - readOffset);
        if (cDur <= 0) continue;

        source.start(schedWhen, readOffset, cDur);
      }
    }

    if (gen !== playbackGenRef.current) return;

    if (metronomeEnabled && bpm > 0) {
      scheduleMetronome(ctx, startOffset, ctx.currentTime);
    }

    // Playhead animation tick
    const tick = () => {
      if (!isPlayingRef.current) return;
      const elapsed = ctx.currentTime - startTimeRef.current;
      const pos     = startOffsetRef.current + elapsed;
      setPlayheadPosition(pos);

      const { isLooping, loopRegion, arrangementClips: clips, metronomeEnabled: metroOn, bpm: metroBpm } =
        useProjectStore.getState();

      if (metroOn && metroBpm > 0 && pos + METRONOME_EXTEND_THRESHOLD_SEC > metronomeScheduledUntilRef.current) {
        const ctxAnchor = startTimeRef.current + (metronomeScheduledUntilRef.current - startOffsetRef.current);
        scheduleMetronome(ctx, metronomeScheduledUntilRef.current, ctxAnchor);
      }

      if (isLooping && loopRegion && pos >= loopRegion.end) {
        schedulePlayback(loopRegion.start);
        setPlayheadPosition(loopRegion.start);
        return;
      }

      if (!isLooping) {
        if (clips.length === 0) {
          // Source-only: stop when the ctx clock passes the source end time
          if (sourceEndCtxRef.current > 0 && ctx.currentTime >= sourceEndCtxRef.current + 0.05) {
            softStopSources();
            setPlaybackState('stopped');
            return;
          }
        } else {
          const lastEnd = Math.max(...clips.map(c => {
            const r = Math.max(0.05, c.stretchRatio || 1.0);
            return c.timelinePosition + (c.nudgeOffset || 0) / 1000 + stretchedTimelineDuration(c.sourceDuration, r);
          }));
          if (pos >= lastEnd + 0.2) {
            softStopSources();
            setPlaybackState('stopped');
            return;
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);

    } finally {
      // Always clear the "applying tempo" flag on completion — covers every
      // exit path (success, early-return, gen-mismatch abort, thrown error).
      // No-op when nothing set it (normal play / pause / clip-stretch reschedule).
      setApplyingTempo(false);
    }
  }, [stopAllSources, softStopSources, scheduleMetronome, stopMetronome]);

  // React to playback state transitions
  useEffect(() => {
    if (playbackState === 'playing') {
      const pos = useProjectStore.getState().playheadPosition;
      void schedulePlayback(pos).catch(err => console.error('[TETHR] playback schedule failed', err));
    } else if (playbackState === 'paused') {
      const ctx = contextRef.current;
      if (ctx && isPlayingRef.current) {
        const pausedAt = startOffsetRef.current + (ctx.currentTime - startTimeRef.current);
        useProjectStore.getState().setPlayheadPosition(pausedAt);
        startOffsetRef.current = pausedAt;
      }
      softStopSources();
    } else if (playbackState === 'stopped') {
      softStopSources();
      startOffsetRef.current = 0;
      // Defer playhead reset so the tick loop has already stopped
      setTimeout(() => {
        useProjectStore.getState().setPlayheadPosition(0);
      }, SOFT_STOP_MS * 1000 + 5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackState, playTrigger]);

  // Reschedule when an arrangement clip's stretch ratio changes during
  // playback — but ONLY for user-driven clip edits, not for the per-clip
  // reconform that setBpm() triggers via reconformClipsToGrid(). BPM
  // changes never auto-restretch audio; the user commits them via the
  // "APPLY TEMPO" button in the Transport (bumps playTrigger).
  // Also reschedules when a track's sectionMutes change (mute toggles
  // on the structure ribbon are discrete user clicks).
  useEffect(() => {
    return useProjectStore.subscribe((state, prevState) => {
      if (!isPlayingRef.current || state.playbackState !== 'playing') return;

      const stretchChanged = state.arrangementClips !== prevState.arrangementClips
        && state.arrangementClips.some(c => {
          const prev = prevState.arrangementClips.find(p => p.id === c.id);
          return !prev || prev.stretchRatio !== c.stretchRatio;
        });
      const bpmChanged = state.bpm !== prevState.bpm;
      const userStretchChanged = stretchChanged && !bpmChanged;

      const mutesChanged = state.tracks !== prevState.tracks
        && state.tracks.some(t => {
          const prev = prevState.tracks.find(p => p.id === t.id);
          return prev && prev.sectionMutes !== t.sectionMutes;
        });

      if (!userStretchChanged && !mutesChanged) return;

      const ctx = contextRef.current;
      if (!ctx || ctx.state === 'closed') return;
      const pos = startOffsetRef.current + (ctx.currentTime - startTimeRef.current);
      void schedulePlayback(pos).catch(err =>
        console.error('[TETHR] edit reschedule failed', err),
      );
    });
  }, [schedulePlayback]);

  // Metronome: BPM / toggle changes during playback
  useEffect(() => {
    return useProjectStore.subscribe((state, prevState) => {
      if (!isPlayingRef.current) return;
      if (state.bpm === prevState.bpm && state.metronomeEnabled === prevState.metronomeEnabled) return;

      const ctx = contextRef.current;
      if (!ctx || ctx.state === 'closed') return;

      if (!state.metronomeEnabled) {
        stopMetronome();
        return;
      }
      resyncMetronomeFromPlayhead();
    });
  }, [resyncMetronomeFromPlayhead, stopMetronome]);

  // Live track volume / clip gain while playing (scheduled gains are fixed at play start otherwise)
  useEffect(() => {
    return useProjectStore.subscribe((state, prevState) => {
      if (!isPlayingRef.current) return;
      const ctx = contextRef.current;
      if (!ctx || ctx.state === 'closed') return;

      const trackById = new Map(state.tracks.map(t => [t.id, t]));

      for (const track of state.tracks) {
        const prev = prevState.tracks.find(t => t.id === track.id);
        if (!prev || (prev.volume === track.volume && prev.isMuted === track.isMuted)) continue;

        const vol = trackEffectiveVolume(track);
        for (const entry of scheduledGainsRef.current) {
          if (entry.trackId !== track.id) continue;
          applyLiveGain(ctx, entry.gainNode, entry.clipGain, vol);
        }
      }

      for (const clip of state.arrangementClips) {
        const prev = prevState.arrangementClips.find(c => c.id === clip.id);
        if (!prev || prev.gain === clip.gain) continue;

        const track = trackById.get(clip.trackId);
        if (!track) continue;

        for (const entry of scheduledGainsRef.current) {
          if (entry.clipId !== clip.id) continue;
          entry.clipGain = clip.gain;
          applyLiveGain(ctx, entry.gainNode, clip.gain, trackEffectiveVolume(track));
        }
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      softStopSources();
      contextRef.current?.close().catch(() => {});
    };
  }, []);
}
