import type { BeatCorrectionMap, BeatMarker } from '../types/audio';
import { getTimeStretchedSlice } from './timeStretch';

const ANALYSIS_HOP = 512;
const ANALYSIS_FRAME = 1024;
const MIN_MARKERS = 8;
const CORRECTED_CACHE_MAX = 8;
const correctedCache = new Map<string, AudioBuffer>();
const correctedPending = new Map<string, Promise<AudioBuffer>>();

export function detectBeatCorrectionMap(
  buffer: AudioBuffer,
  bpm: number | null | undefined,
): BeatCorrectionMap | null {
  if (!buffer || !bpm || bpm <= 0 || buffer.duration < 2) return null;

  const sourceBpm = Math.max(40, Math.min(240, bpm));
  const beatInterval = 60 / sourceBpm;
  const envelope = buildOnsetEnvelope(buffer);
  if (!envelope || envelope.values.length < 8) return null;

  const beatFrames = Math.max(1, Math.round(beatInterval / envelope.hopSeconds));
  const phaseFrame = estimateBeatPhase(envelope.values, beatFrames);
  const markers = trackBeats(envelope, sourceBpm, phaseFrame);
  const confidentMarkers = markers.filter(m => m.confidence >= 0.18);

  if (markers.length < MIN_MARKERS || confidentMarkers.length < Math.max(4, markers.length * 0.35)) {
    return null;
  }

  const firstBeatTime = markers[0]?.sourceTime ?? 0;
  const drift = confidentMarkers.map(m =>
    Math.abs(m.sourceTime - (firstBeatTime + m.index * beatInterval)) * 1000,
  );
  const averageDriftMs = drift.length > 0
    ? drift.reduce((sum, d) => sum + d, 0) / drift.length
    : 0;
  const maxDriftMs = drift.length > 0 ? Math.max(...drift) : 0;
  const confidence = Math.max(0, Math.min(1, confidentMarkers.length / markers.length));

  return {
    sourceBpm,
    beatInterval,
    firstBeatTime,
    sourceDuration: buffer.duration,
    markers,
    confidence,
    averageDriftMs,
    maxDriftMs,
  };
}

export function beatCorrectedDuration(
  map: BeatCorrectionMap | null | undefined,
  targetBpm: number,
  sourceDuration: number,
): number {
  if (!map || map.markers.length < 2 || targetBpm <= 0) {
    return sourceDuration;
  }
  const anchors = buildAnchors(map, targetBpm, sourceDuration);
  return anchors[anchors.length - 1]?.target ?? sourceDuration;
}

export function sourceTimeToCorrectedTime(
  map: BeatCorrectionMap | null | undefined,
  sourceTime: number,
  targetBpm: number,
): number {
  if (!map || map.markers.length < 2 || targetBpm <= 0) return sourceTime;
  const anchors = buildAnchors(map, targetBpm, map.sourceDuration);
  const t = Math.max(0, Math.min(map.sourceDuration, sourceTime));
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (t < a.source || t > b.source) continue;
    const span = Math.max(0.001, b.source - a.source);
    const p = (t - a.source) / span;
    return a.target + p * (b.target - a.target);
  }
  return t;
}

export async function getBeatCorrectedBuffer(
  ctx: BaseAudioContext,
  trackId: string,
  buffer: AudioBuffer,
  map: BeatCorrectionMap | null | undefined,
  targetBpm: number,
): Promise<AudioBuffer | null> {
  if (!map || map.markers.length < MIN_MARKERS || targetBpm <= 0) return null;

  const anchors = buildAnchors(map, targetBpm, buffer.duration);
  if (anchors.length < 3) return null;

  const cacheKey = [
    trackId,
    'beat-correct',
    buffer.sampleRate,
    buffer.length,
    targetBpm.toFixed(4),
    map.sourceBpm.toFixed(4),
    map.markers.length,
    map.markers[0]?.sourceTime.toFixed(4),
    map.markers[map.markers.length - 1]?.sourceTime.toFixed(4),
    map.averageDriftMs.toFixed(2),
  ].join(':');

  const cached = correctedCache.get(cacheKey);
  if (cached) return cached;
  const inflight = correctedPending.get(cacheKey);
  if (inflight) return inflight;

  const task = renderBeatCorrectedBuffer(ctx, trackId, buffer, anchors, cacheKey);
  correctedPending.set(cacheKey, task);
  try {
    const rendered = await task;
    if (correctedCache.size >= CORRECTED_CACHE_MAX) {
      const first = correctedCache.keys().next().value;
      if (first) correctedCache.delete(first);
    }
    correctedCache.set(cacheKey, rendered);
    return rendered;
  } finally {
    correctedPending.delete(cacheKey);
  }
}

export function clearBeatCorrectionCacheForTrack(trackId: string) {
  for (const key of [...correctedCache.keys()]) {
    if (key.startsWith(`${trackId}:`)) correctedCache.delete(key);
  }
  for (const key of [...correctedPending.keys()]) {
    if (key.startsWith(`${trackId}:`)) correctedPending.delete(key);
  }
}

type OnsetEnvelope = {
  values: Float32Array;
  hopSeconds: number;
  threshold: number;
};

type Anchor = { source: number; target: number };

function buildOnsetEnvelope(buffer: AudioBuffer): OnsetEnvelope | null {
  const sampleRate = buffer.sampleRate;
  const frameCount = Math.floor((buffer.length - ANALYSIS_FRAME) / ANALYSIS_HOP);
  if (frameCount < 8) return null;

  const channels = Math.min(2, buffer.numberOfChannels);
  const channelData = Array.from({ length: channels }, (_, ch) => buffer.getChannelData(ch));
  const raw = new Float32Array(frameCount);
  let prevRms = 0;
  let prevFlux = 0;
  let max = 0;

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * ANALYSIS_HOP;
    let energy = 0;
    let flux = 0;
    let prevSample = 0;
    for (let i = 0; i < ANALYSIS_FRAME; i++) {
      let sample = 0;
      for (let ch = 0; ch < channels; ch++) {
        sample += channelData[ch][start + i] ?? 0;
      }
      sample /= channels;
      energy += sample * sample;
      flux += Math.abs(sample - prevSample);
      prevSample = sample;
    }
    const rms = Math.sqrt(energy / ANALYSIS_FRAME);
    const transientFlux = flux / ANALYSIS_FRAME;
    const onset = Math.max(0, rms - prevRms) * 0.68
      + Math.max(0, transientFlux - prevFlux) * 0.32;
    raw[frame] = onset;
    if (onset > max) max = onset;
    prevRms = rms;
    prevFlux = transientFlux;
  }

  if (max <= 0) return null;

  const values = new Float32Array(frameCount);
  let sum = 0;
  for (let i = 0; i < frameCount; i++) {
    const prev = raw[Math.max(0, i - 1)];
    const cur = raw[i];
    const next = raw[Math.min(frameCount - 1, i + 1)];
    const v = ((prev * 0.25) + (cur * 0.5) + (next * 0.25)) / max;
    values[i] = v;
    sum += v;
  }

  const mean = sum / frameCount;
  let variance = 0;
  for (let i = 0; i < frameCount; i++) {
    const d = values[i] - mean;
    variance += d * d;
  }
  const stdev = Math.sqrt(variance / frameCount);

  return {
    values,
    hopSeconds: ANALYSIS_HOP / sampleRate,
    threshold: Math.max(0.045, Math.min(0.35, mean + stdev * 0.35)),
  };
}

function estimateBeatPhase(values: Float32Array, beatFrames: number): number {
  const phaseStep = Math.max(1, Math.floor(beatFrames / 72));
  const localRadius = Math.max(1, Math.floor(beatFrames * 0.06));
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let phase = 0; phase < beatFrames; phase += phaseStep) {
    let score = 0;
    let count = 0;
    for (let frame = phase; frame < values.length; frame += beatFrames) {
      score += localPeak(values, frame, localRadius).strength;
      count++;
    }
    const normalized = count > 0 ? score / Math.sqrt(count) : 0;
    if (normalized > bestScore) {
      bestScore = normalized;
      bestPhase = phase;
    }
  }
  return bestPhase;
}

function trackBeats(envelope: OnsetEnvelope, sourceBpm: number, phaseFrame: number): BeatMarker[] {
  const beatInterval = 60 / sourceBpm;
  const beatFrames = Math.max(1, Math.round(beatInterval / envelope.hopSeconds));
  const searchRadius = Math.max(2, Math.floor(beatFrames * 0.28));
  const minSpacingSeconds = beatInterval * 0.45;
  const markers: BeatMarker[] = [];
  let predictedFrame = phaseFrame;

  for (let index = 0; predictedFrame < envelope.values.length; index++) {
    const peak = localPeak(envelope.values, predictedFrame, searchRadius);
    const strongEnough = peak.strength >= envelope.threshold;
    const peakTime = peak.index * envelope.hopSeconds;
    const predictedTime = predictedFrame * envelope.hopSeconds;
    const prev = markers[markers.length - 1];
    const tooClose = prev && peakTime - prev.sourceTime < minSpacingSeconds;
    const sourceTime = strongEnough && !tooClose ? peakTime : predictedTime;
    const strength = strongEnough && !tooClose ? peak.strength : Math.max(0, peak.strength * 0.45);

    markers.push({
      index,
      sourceTime,
      confidence: Math.max(0, Math.min(1, strength)),
      strength,
    });

    predictedFrame = Math.round((sourceTime + beatInterval) / envelope.hopSeconds);
  }

  return markers.filter(m => m.sourceTime >= 0 && Number.isFinite(m.sourceTime));
}

function localPeak(values: Float32Array, center: number, radius: number): { index: number; strength: number } {
  const start = Math.max(0, center - radius);
  const end = Math.min(values.length - 1, center + radius);
  let bestIndex = Math.max(0, Math.min(values.length - 1, center));
  let bestStrength = values[bestIndex] ?? 0;
  for (let i = start; i <= end; i++) {
    const v = values[i];
    if (v > bestStrength) {
      bestStrength = v;
      bestIndex = i;
    }
  }
  return { index: bestIndex, strength: bestStrength };
}

function buildAnchors(map: BeatCorrectionMap, targetBpm: number, sourceDuration: number): Anchor[] {
  const sourceToTargetRatio = targetBpm / map.sourceBpm;
  const targetBeatInterval = 60 / targetBpm;
  const targetFirstBeat = map.firstBeatTime / Math.max(0.05, sourceToTargetRatio);
  const anchors: Anchor[] = [{ source: 0, target: 0 }];

  for (const marker of map.markers) {
    const source = Math.max(0, Math.min(sourceDuration, marker.sourceTime));
    const target = Math.max(0, targetFirstBeat + marker.index * targetBeatInterval);
    const last = anchors[anchors.length - 1];
    if (source <= last.source + 0.035 || target <= last.target + 0.035) continue;
    anchors.push({ source, target });
  }

  const last = anchors[anchors.length - 1];
  if (sourceDuration > last.source + 0.035) {
    const tailTarget = last.target + (sourceDuration - last.source) / Math.max(0.05, sourceToTargetRatio);
    anchors.push({ source: sourceDuration, target: Math.max(last.target + 0.035, tailTarget) });
  }

  return anchors;
}

async function renderBeatCorrectedBuffer(
  ctx: BaseAudioContext,
  trackId: string,
  buffer: AudioBuffer,
  anchors: Anchor[],
  cacheKey: string,
): Promise<AudioBuffer> {
  const correctedDuration = anchors[anchors.length - 1]?.target ?? buffer.duration;
  const sampleRate = buffer.sampleRate;
  const outFrames = Math.max(1, Math.ceil((correctedDuration + 0.02) * sampleRate));
  const out = ctx.createBuffer(buffer.numberOfChannels, outFrames, sampleRate);
  const fadeFrames = Math.max(8, Math.floor(sampleRate * 0.0035));

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const sourceDuration = b.source - a.source;
    const targetDuration = b.target - a.target;
    if (sourceDuration <= 0.025 || targetDuration <= 0.025) continue;

    const ratio = Math.max(0.25, Math.min(4, sourceDuration / targetDuration));
    const slice = await getTimeStretchedSlice(
      ctx,
      `${trackId}:${cacheKey}`,
      buffer,
      a.source,
      sourceDuration,
      ratio,
    );

    mixSlice(out, slice, Math.round(a.target * sampleRate), fadeFrames, i > 0, i < anchors.length - 2);
  }

  return out;
}

function mixSlice(
  out: AudioBuffer,
  slice: AudioBuffer,
  startFrame: number,
  fadeFrames: number,
  fadeIn: boolean,
  fadeOut: boolean,
) {
  const channels = Math.min(out.numberOfChannels, slice.numberOfChannels);
  for (let ch = 0; ch < channels; ch++) {
    const dst = out.getChannelData(ch);
    const src = slice.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      const outIndex = startFrame + i;
      if (outIndex < 0 || outIndex >= dst.length) continue;
      let gain = 1;
      if (fadeIn && i < fadeFrames) gain *= i / fadeFrames;
      if (fadeOut && src.length - i <= fadeFrames) gain *= Math.max(0, (src.length - i) / fadeFrames);
      dst[outIndex] += src[i] * gain;
    }
  }
}
