import { processOffline } from '@soundtouchjs/audio-worklet';
import soundtouchProcessorUrl from '@soundtouchjs/audio-worklet/processor?url';

const CACHE_MAX = 48;
const cache = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer>>();

export function stretchCacheKey(
  trackId: string,
  sourceStart: number,
  sourceDuration: number,
  tempoRatio: number,
): string {
  return `${trackId}:${sourceStart.toFixed(4)}:${sourceDuration.toFixed(4)}:${tempoRatio.toFixed(4)}`;
}

function sliceBuffer(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  sourceStart: number,
  sourceDuration: number,
): AudioBuffer {
  const start = Math.max(0, Math.min(buffer.duration - 0.001, sourceStart));
  const dur = Math.max(0, Math.min(buffer.duration - start, sourceDuration));
  const frames = Math.max(1, Math.ceil(dur * buffer.sampleRate));
  const out = ctx.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    const i0 = Math.floor(start * buffer.sampleRate);
    dst.set(src.subarray(i0, i0 + frames));
  }
  return out;
}

/** Tempo ratio: 1 = native speed, 1.2 = 20% faster (shorter), pitch preserved via SoundTouch. */
export async function getTimeStretchedSlice(
  ctx: BaseAudioContext,
  trackId: string,
  buffer: AudioBuffer,
  sourceStart: number,
  sourceDuration: number,
  tempoRatio: number,
): Promise<AudioBuffer> {
  const ratio = Math.max(0.05, Math.min(4, tempoRatio));
  const key = stretchCacheKey(trackId, sourceStart, sourceDuration, ratio);

  const hit = cache.get(key);
  if (hit) return hit;

  const inflight = pending.get(key);
  if (inflight) return inflight;

  const task = (async () => {
    const slice = sliceBuffer(ctx, buffer, sourceStart, sourceDuration);
    if (Math.abs(ratio - 1) < 0.001) {
      cache.set(key, slice);
      return slice;
    }

    const stretched = await processOffline({
      input: slice,
      processorUrl: soundtouchProcessorUrl,
      playbackRate: ratio,
      pitch: 1,
    });

    if (cache.size >= CACHE_MAX) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    cache.set(key, stretched);
    return stretched;
  })();

  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

export function clearStretchCacheForTrack(trackId: string) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${trackId}:`)) cache.delete(key);
  }
}

export function clearStretchCache() {
  cache.clear();
  pending.clear();
}

/**
 * Conform native track tempo to project tempo. Returns the pitch-preserving
 * stretch ratio in the SoundTouch convention used by `getTimeStretchedSlice`:
 *   ratio > 1  → output is faster and shorter
 *   ratio < 1  → output is slower and longer
 *
 * Therefore: project tempo HIGHER than source ⇒ ratio > 1 ⇒ faster.
 *            project tempo LOWER than source  ⇒ ratio < 1 ⇒ slower.
 *
 * Formula is projectBpm / estimatedBpm (NOT the inverse — that bug shipped
 * briefly and made BPM changes feel reversed).
 */
export function conformTempoRatio(
  estimatedBpm: number | null | undefined,
  projectBpm: number,
): number {
  if (!estimatedBpm || estimatedBpm <= 0 || projectBpm <= 0) return 1;
  return Math.max(0.25, Math.min(4, projectBpm / estimatedBpm));
}

export function stretchedTimelineDuration(sourceDuration: number, tempoRatio: number): number {
  return sourceDuration / Math.max(0.05, tempoRatio);
}
