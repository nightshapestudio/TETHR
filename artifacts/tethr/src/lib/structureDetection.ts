import type { StructureSegment } from '../types/audio';

/**
 * Heuristic song-structure detection.
 *
 * Strategy (no ML, deliberately simple):
 *   1. Window the audio in 1-bar chunks (bar length derived from detected BPM).
 *   2. Compute RMS energy per window.
 *   3. Normalize 0..1 and quantize into low / mid / high bins.
 *   4. Group consecutive same-level windows.
 *   5. Smooth: merge groups shorter than MIN_BARS into their neighbour, then
 *      collapse adjacent same-level groups created by the merge.
 *   6. Label groups by position + energy:
 *        first group  → INTRO
 *        last group   → OUTRO
 *        high energy  → CHORUS
 *        mid energy   → VERSE
 *        low energy   → BREAKDOWN
 *   7. Number repeats: "CHORUS 1", "CHORUS 2", etc.
 *
 * Output coordinates are in source seconds — they line up with the waveform
 * canvas directly (which also renders in source-time).
 *
 * Cheap enough to run inline on import (one pass over the first mono channel).
 */
export function detectStructure(
  buffer: AudioBuffer,
  bpm: number,
): StructureSegment[] {
  if (!buffer || buffer.duration <= 0) return [];

  const sampleRate = buffer.sampleRate;
  const channel = buffer.getChannelData(0);
  const safeBpm = bpm > 0 ? bpm : 120;
  const secPerBar = (60 / safeBpm) * 4;

  const windowSamples = Math.max(1, Math.floor(secPerBar * sampleRate));
  const numWindows = Math.floor(channel.length / windowSamples);

  // Need at least a few bars for segmentation to mean anything.
  if (numWindows < 4) return [];

  // --- 1. RMS per bar ---
  const rms = new Float32Array(numWindows);
  let maxRms = 0;
  for (let i = 0; i < numWindows; i++) {
    let sum = 0;
    const base = i * windowSamples;
    for (let j = 0; j < windowSamples; j++) {
      const s = channel[base + j];
      sum += s * s;
    }
    const v = Math.sqrt(sum / windowSamples);
    rms[i] = v;
    if (v > maxRms) maxRms = v;
  }
  if (maxRms === 0) return [];

  // --- 2. Normalize + quantize ---
  type Level = 'low' | 'mid' | 'high';
  const levels: Level[] = new Array(numWindows);
  for (let i = 0; i < numWindows; i++) {
    const n = rms[i] / maxRms;
    levels[i] = n < 0.32 ? 'low' : n < 0.72 ? 'mid' : 'high';
  }

  // --- 3. Group consecutive same-level windows ---
  type Group = { start: number; end: number; level: Level };
  const groups: Group[] = [];
  for (let i = 0; i < numWindows; i++) {
    const last = groups[groups.length - 1];
    if (!last || last.level !== levels[i]) {
      groups.push({ start: i, end: i, level: levels[i] });
    } else {
      last.end = i;
    }
  }

  // --- 4. Smooth: absorb groups shorter than MIN_BARS into the previous one ---
  const MIN_BARS = 2;
  const absorbed: Group[] = [];
  for (const g of groups) {
    const len = g.end - g.start + 1;
    if (len < MIN_BARS && absorbed.length > 0) {
      absorbed[absorbed.length - 1].end = g.end;
    } else {
      absorbed.push({ ...g });
    }
  }
  // Second pass: collapse adjacent groups that became same-level after absorption.
  const collapsed: Group[] = [];
  for (const g of absorbed) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.level === g.level) {
      last.end = g.end;
    } else {
      collapsed.push({ ...g });
    }
  }

  if (collapsed.length === 0) return [];

  // --- 5. Position + energy → label ---
  const N = collapsed.length;
  const segments: StructureSegment[] = collapsed.map((g, i) => {
    let label: string;
    if (i === 0) {
      label = 'INTRO';
    } else if (i === N - 1) {
      label = 'OUTRO';
    } else if (g.level === 'high') {
      label = 'CHORUS';
    } else if (g.level === 'mid') {
      label = 'VERSE';
    } else {
      label = 'BREAKDOWN';
    }
    return {
      start: g.start * secPerBar,
      end: Math.min(buffer.duration, (g.end + 1) * secPerBar),
      label,
      energy: g.level,
    };
  });

  // --- 6. Number repeats (skip INTRO / OUTRO which are unique by position) ---
  const counts: Record<string, number> = {};
  for (const s of segments) counts[s.label] = (counts[s.label] || 0) + 1;
  const seen: Record<string, number> = {};
  for (const s of segments) {
    if (counts[s.label] > 1 && s.label !== 'INTRO' && s.label !== 'OUTRO') {
      seen[s.label] = (seen[s.label] || 0) + 1;
      s.label = `${s.label} ${seen[s.label]}`;
    }
  }

  return segments;
}
