/** 4/4 grid — matches BeatGrid bar lines (every 4 beats). */
export const METRONOME_BEATS_PER_BAR = 4;

const CLICK_DURATION_SEC = 0.042;

export type MetronomeBuffers = {
  beat: AudioBuffer;
  downbeat: AudioBuffer;
};

/** Restrained futuristic tick — short tonal ping + filtered noise burst. */
function synthesizeClick(ctx: AudioContext, downbeat: boolean): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.ceil(CLICK_DURATION_SEC * sr));
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);

  const f0 = downbeat ? 440 : 1180;
  const f1 = downbeat ? 880 : 2360;
  const peak = downbeat ? 0.38 : 0.24;
  const decay = downbeat ? 38 : 52;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.exp(-t * decay);
    const tone =
      0.72 * Math.sin(2 * Math.PI * f0 * t) +
      0.22 * Math.sin(2 * Math.PI * f1 * t);
    const noise = (Math.random() * 2 - 1) * 0.18 * Math.exp(-t * 90);
    const click = (tone + noise) * env * peak;
    // Micro fade-in avoids digital click at sample 0
    const fadeIn = Math.min(1, t / 0.0008);
    data[i] = click * fadeIn;
  }

  return buf;
}

export function createMetronomeBuffers(ctx: AudioContext): MetronomeBuffers {
  return {
    beat: synthesizeClick(ctx, false),
    downbeat: synthesizeClick(ctx, true),
  };
}

export function scheduleMetronomeClicks(
  ctx: AudioContext,
  output: AudioNode,
  buffers: MetronomeBuffers,
  opts: {
    bpm: number;
    timelineStart: number;
    ctxAnchorTime: number;
    scheduleUntilTimeline: number;
  },
): AudioBufferSourceNode[] {
  const { bpm, timelineStart, ctxAnchorTime, scheduleUntilTimeline } = opts;
  if (bpm <= 0) return [];

  const beatSec = 60 / bpm;
  const sources: AudioBufferSourceNode[] = [];
  const now = ctx.currentTime;

  const firstBeat = Math.max(0, Math.ceil(timelineStart / beatSec - 1e-6));
  const lastBeat = Math.max(firstBeat, Math.floor(scheduleUntilTimeline / beatSec));

  for (let i = firstBeat; i <= lastBeat; i++) {
    const beatTimeline = i * beatSec;
    const when = ctxAnchorTime + (beatTimeline - timelineStart);
    if (when < now - 0.02) continue;

    const src = ctx.createBufferSource();
    src.buffer = i % METRONOME_BEATS_PER_BAR === 0 ? buffers.downbeat : buffers.beat;
    src.connect(output);
    try {
      src.start(when);
      sources.push(src);
    } catch (_) {}
  }

  return sources;
}

export function stopMetronomeSources(sources: AudioBufferSourceNode[], ctx: AudioContext | null) {
  const t = ctx?.currentTime ?? 0;
  for (const src of sources) {
    try {
      src.stop(t);
    } catch (_) {}
    try {
      src.disconnect();
    } catch (_) {}
  }
}
