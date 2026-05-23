import { SnapResolution } from '../types/audio';

export function gridInterval(bpm: number, resolution: SnapResolution): number {
  const beatSec = 60 / bpm;
  switch (resolution) {
    case 'bar':      return beatSec * 4;
    case 'beat':     return beatSec;
    case '1/2-beat': return beatSec / 2;
    case '1/4-beat': return beatSec / 4;
    default:         return beatSec * 4;
  }
}

/**
 * Snap pos to nearest grid boundary.
 * shiftHeld inverts snapEnabled (shift = invert snap).
 */
export function snapPosition(
  pos: number,
  bpm: number,
  snapEnabled: boolean,
  resolution: SnapResolution,
  shiftHeld: boolean,
): number {
  const shouldSnap = shiftHeld ? !snapEnabled : snapEnabled;
  if (!shouldSnap || bpm <= 0) return pos;
  const interval = gridInterval(bpm, resolution);
  if (interval <= 0) return pos;
  return Math.round(pos / interval) * interval;
}

/**
 * Snap forward to the next clean grid boundary at or after pos.
 * Used for append insert positions so new clips land on a clean beat/bar.
 */
export function snapForward(
  pos: number,
  bpm: number,
  snapEnabled: boolean,
  resolution: SnapResolution,
): number {
  if (!snapEnabled || bpm <= 0) return pos;
  const interval = gridInterval(bpm, resolution);
  if (interval <= 0) return pos;
  const snapped = Math.ceil(pos / interval) * interval;
  return snapped;
}
