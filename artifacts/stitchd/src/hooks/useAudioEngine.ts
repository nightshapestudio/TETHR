import { useEffect, useRef, useCallback } from 'react';
import { useProjectStore } from '../store/useProjectStore';

// ---------------------------------------------------------------------------
// Module-level meter analysers — read by LevelMeter without prop drilling
// ---------------------------------------------------------------------------
export const meterAnalysers: { left: AnalyserNode | null; right: AnalyserNode | null } = {
  left: null,
  right: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const stretchedDuration = (sourceDuration: number, stretchRatio: number) =>
  sourceDuration / Math.max(0.05, stretchRatio);

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

// ---------------------------------------------------------------------------
// Standalone WAV render — callable from anywhere, no hook needed
// ---------------------------------------------------------------------------
export async function renderArrangement(sampleRate: number = 44100): Promise<Blob> {
  const { arrangementClips, tracks } = useProjectStore.getState();

  if (arrangementClips.length === 0) return new Blob([], { type: 'audio/wav' });

  let maxTime = 0;
  arrangementClips.forEach(c => {
    const nudgeSec = (c.nudgeOffset || 0) / 1000;
    const outDuration = stretchedDuration(c.sourceDuration, c.stretchRatio || 1.0);
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
    const outDuration = stretchedDuration(clip.sourceDuration, stretchR);
    const effectiveEnd = effectiveStart + outDuration;

    let buffer = track.audioBuffer;
    if (buffer.sampleRate !== sampleRate) {
      const resCtx = new OfflineAudioContext(
        buffer.numberOfChannels,
        Math.ceil(buffer.duration * sampleRate),
        sampleRate
      );
      const s = resCtx.createBufferSource();
      s.buffer = buffer;
      s.connect(resCtx.destination);
      s.start(0);
      buffer = await resCtx.startRendering();
    }

    const gainNode = offlineCtx.createGain();
    gainNode.connect(masterGain);
    const targetGain = Math.max(0, clip.gain) * Math.max(0, track.volume);
    const fadeCurve: FadeCurve = (clip.fadeCurve as FadeCurve) || 'equal-power';

    const totalFades = (clip.fadeIn || 0) + (clip.fadeOut || 0);
    const fadeScale = totalFades > 0 && totalFades > outDuration ? outDuration / totalFades : 1.0;
    const safeFadeIn = (clip.fadeIn || 0) * fadeScale;
    const safeFadeOut = (clip.fadeOut || 0) * fadeScale;

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
    source.buffer = buffer;
    source.playbackRate.value = stretchR;
    source.connect(gainNode);

    const srcReadStart = Math.max(0, clip.sourceStart + (clip.slipOffset || 0));
    const readDuration = Math.max(0, clip.sourceDuration);
    const clampedStart = Math.min(buffer.duration - 0.001, srcReadStart);
    const clampedDuration = Math.max(0, Math.min(buffer.duration - clampedStart, readDuration));
    if (clampedDuration <= 0) continue;

    source.start(effectiveStart, clampedStart, clampedDuration);
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

// ---------------------------------------------------------------------------
// Hook — manages the live AudioContext for playback only
// ---------------------------------------------------------------------------
export function useAudioEngine() {
  const contextRef = useRef<AudioContext | null>(null);
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainNodesRef = useRef<AudioNode[]>([]);
  const startOffsetRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  // Tracks the end time for source-only playback (no arrangement clips)
  const sourceEndRef = useRef<number>(0);

  const playbackState = useProjectStore(s => s.playbackState);
  const playTrigger = useProjectStore(s => s.playTrigger);

  const getCtx = (): AudioContext => {
    if (!contextRef.current || contextRef.current.state === 'closed') {
      contextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return contextRef.current;
  };

  const stopAllSources = useCallback(() => {
    sourceNodesRef.current.forEach(n => {
      try { n.stop(0); } catch (_) {}
      try { n.disconnect(); } catch (_) {}
    });
    gainNodesRef.current.forEach(n => {
      try { n.disconnect(); } catch (_) {}
    });
    sourceNodesRef.current = [];
    gainNodesRef.current = [];
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    isPlayingRef.current = false;
    meterAnalysers.left = null;
    meterAnalysers.right = null;
  }, []);

  const schedulePlayback = useCallback((startOffset: number) => {
    const ctx = getCtx();
    const {
      arrangementClips,
      tracks,
      selectedTrackId,
      setPlayheadPosition,
      setPlaybackState,
    } = useProjectStore.getState();

    stopAllSources();
    if (ctx.state === 'suspended') ctx.resume();

    startOffsetRef.current = startOffset;
    startTimeRef.current = ctx.currentTime;
    isPlayingRef.current = true;
    sourceEndRef.current = 0;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(ctx.destination);
    gainNodesRef.current.push(masterGain);

    // Stereo metering tap
    try {
      const splitter = ctx.createChannelSplitter(2);
      masterGain.connect(splitter);
      const aL = ctx.createAnalyser();
      aL.fftSize = 1024;
      aL.smoothingTimeConstant = 0;
      splitter.connect(aL, 0);
      const aR = ctx.createAnalyser();
      aR.fftSize = 1024;
      aR.smoothingTimeConstant = 0;
      splitter.connect(aR, 1);
      meterAnalysers.left = aL;
      meterAnalysers.right = aR;
    } catch (_) {}

    const hasClips = arrangementClips.length > 0;

    if (!hasClips) {
      // -----------------------------------------------------------------------
      // SOURCE-ONLY mode: play selected track, reference track, or first track.
      // This lets users audition imported tracks before building an arrangement.
      // -----------------------------------------------------------------------
      const sourceTrack =
        tracks.find(t => t.id === selectedTrackId) ||
        tracks.find(t => t.isReference) ||
        tracks[0];

      if (!sourceTrack || !sourceTrack.audioBuffer || sourceTrack.isMuted) {
        stopAllSources();
        setPlaybackState('stopped');
        return;
      }

      const buf = sourceTrack.audioBuffer;
      const cStart = Math.max(0, Math.min(buf.duration - 0.001, startOffset));
      const cDur = Math.max(0, buf.duration - cStart);
      if (cDur <= 0) {
        stopAllSources();
        setPlaybackState('stopped');
        return;
      }

      const gainNode = ctx.createGain();
      gainNode.gain.value = Math.max(0, sourceTrack.volume);
      gainNode.connect(masterGain);
      gainNodesRef.current.push(gainNode);

      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(gainNode);
      sourceNodesRef.current.push(source);
      source.start(ctx.currentTime, cStart, cDur);

      // Record when this source ends so the tick loop can auto-stop
      sourceEndRef.current = buf.duration;
    } else {
      // -----------------------------------------------------------------------
      // ARRANGEMENT mode: schedule all clips in the arrangement lane
      // -----------------------------------------------------------------------
      arrangementClips.forEach(clip => {
        const track = tracks.find(t => t.id === clip.trackId);
        if (!track || !track.audioBuffer || track.isMuted) return;

        const nudgeSec = (clip.nudgeOffset || 0) / 1000;
        const effStart = clip.timelinePosition + nudgeSec;
        const stretchR = Math.max(0.05, clip.stretchRatio || 1.0);
        const outDuration = stretchedDuration(clip.sourceDuration, stretchR);
        const effEnd = effStart + outDuration;

        if (effEnd <= startOffset) return;

        const gainNode = ctx.createGain();
        gainNodesRef.current.push(gainNode);
        gainNode.connect(masterGain);

        const targetGain = Math.max(0, clip.gain) * Math.max(0, track.volume);
        const fadeCurve: FadeCurve = (clip.fadeCurve as FadeCurve) || 'equal-power';

        const clipWhen = ctx.currentTime + Math.max(0, effStart - startOffset);
        const clipEndWhen = ctx.currentTime + Math.max(0, effEnd - startOffset);

        gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);

        if (effStart >= startOffset) {
          scheduleFadeIn(gainNode.gain, fadeCurve, clipWhen, clip.fadeIn, targetGain);
        } else {
          gainNode.gain.setValueAtTime(targetGain, ctx.currentTime);
        }

        if (clip.fadeOut > 0) {
          const foStartWhen = clipEndWhen - clip.fadeOut;
          if (foStartWhen > ctx.currentTime) {
            scheduleFadeOut(gainNode.gain, fadeCurve, foStartWhen, clip.fadeOut, targetGain);
          } else if (clipEndWhen > ctx.currentTime + 0.005) {
            const elapsedInFade = ctx.currentTime - foStartWhen;
            const remaining = clip.fadeOut - elapsedInFade;
            if (remaining > 0.005) {
              const progress = Math.min(1, elapsedInFade / clip.fadeOut);
              const fromGain = Math.max(0.001, targetGain * (1 - progress));
              scheduleFadeOut(gainNode.gain, fadeCurve, ctx.currentTime + 0.001, remaining, fromGain);
            } else {
              gainNode.gain.setValueAtTime(0, ctx.currentTime);
            }
          }
        }

        const source = ctx.createBufferSource();
        source.buffer = track.audioBuffer;
        source.playbackRate.value = stretchR;
        source.connect(gainNode);
        sourceNodesRef.current.push(source);

        let srcStart = clip.sourceStart + (clip.slipOffset || 0);
        let schedWhen = clipWhen;

        if (effStart < startOffset) {
          const outputElapsed = startOffset - effStart;
          const sourceElapsed = outputElapsed * stretchR;
          srcStart += sourceElapsed;
          schedWhen = ctx.currentTime;
        }

        const buf = track.audioBuffer;
        const cStart = Math.max(0, Math.min(buf.duration - 0.001, srcStart));
        const remainingSource = clip.sourceDuration - (cStart - clip.sourceStart - (clip.slipOffset || 0));
        const cDur = Math.max(0, Math.min(buf.duration - cStart, remainingSource));
        if (cDur <= 0) return;

        source.start(schedWhen, cStart, cDur);
      });
    }

    // Playhead animation tick
    const tick = () => {
      if (!isPlayingRef.current) return;
      const elapsed = ctx.currentTime - startTimeRef.current;
      const pos = startOffsetRef.current + elapsed;
      setPlayheadPosition(pos);

      const { isLooping, loopRegion, arrangementClips: clips } = useProjectStore.getState();

      if (isLooping && loopRegion && pos >= loopRegion.end) {
        schedulePlayback(loopRegion.start);
        setPlayheadPosition(loopRegion.start);
        return;
      }

      if (!isLooping) {
        if (clips.length === 0) {
          // Source-only mode: stop when past the track end
          if (sourceEndRef.current > 0 && pos >= sourceEndRef.current + 0.1) {
            stopAllSources();
            setPlaybackState('stopped');
            return;
          }
        } else {
          const lastEnd = Math.max(...clips.map(c => {
            const r = Math.max(0.05, c.stretchRatio || 1.0);
            return c.timelinePosition + (c.nudgeOffset || 0) / 1000 + stretchedDuration(c.sourceDuration, r);
          }));
          if (pos >= lastEnd + 0.2) {
            stopAllSources();
            setPlaybackState('stopped');
            return;
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  }, [stopAllSources]);

  // React to playback state and play trigger changes
  useEffect(() => {
    if (playbackState === 'playing') {
      const pos = useProjectStore.getState().playheadPosition;
      schedulePlayback(pos);
    } else if (playbackState === 'paused') {
      const ctx = contextRef.current;
      if (ctx && isPlayingRef.current) {
        const pausedAt = startOffsetRef.current + (ctx.currentTime - startTimeRef.current);
        useProjectStore.getState().setPlayheadPosition(pausedAt);
        startOffsetRef.current = pausedAt;
      }
      stopAllSources();
    } else if (playbackState === 'stopped') {
      stopAllSources();
      startOffsetRef.current = 0;
      useProjectStore.getState().setPlayheadPosition(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackState, playTrigger]);

  useEffect(() => {
    return () => {
      stopAllSources();
      contextRef.current?.close().catch(() => {});
    };
  }, []);
}
