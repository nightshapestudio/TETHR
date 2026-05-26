export interface AudioTrack {
  id: string;
  name: string;
  file: File;
  fileName: string;
  duration: number;         // seconds
  sampleRate: number;
  channelCount: number;
  audioBuffer: AudioBuffer | null;
  waveformData: Float32Array | null;  // downsampled peak data for canvas
  color: string;            // unique per-track color
  isReference: boolean;
  isMuted: boolean;
  volume: number;           // 0-1
  estimatedBpm: number | null;  // detected BPM, null if detection failed or not run
  bpmConfidence: number;        // 0–1, autocorrelation confidence
  structureSegments: StructureSegment[];  // heuristic structure (intro/verse/chorus/…)
  sectionMutes: SectionMute[];  // direct-manipulation mute regions (source seconds)
}

/** A muted region on the source track — silences during playback & export
 *  without requiring an arrangement clip. Coordinates in SOURCE seconds. */
export interface SectionMute {
  start: number;
  end: number;
}

/** Heuristic structural region within a track (energy-grouped, bar-snapped). */
export interface StructureSegment {
  start: number;            // seconds in source
  end: number;              // seconds in source
  label: string;            // e.g. "INTRO" | "VERSE 1" | "CHORUS 2" | "BREAKDOWN" | "OUTRO"
  energy: 'low' | 'mid' | 'high';
}

export type SectionLabel =
  | 'intro'
  | 'verse'
  | 'pre'
  | 'chorus'
  | 'bridge'
  | 'breakdown'
  | 'outro';

export interface Clip {
  id: string;
  trackId: string;
  sourceStart: number;      // seconds into source file
  sourceDuration: number;   // seconds
  timelinePosition: number; // seconds in timeline
  nudgeOffset: number;      // fine-tune offset in ms
  slipOffset: number;       // slip edit offset in seconds
  fadeIn: number;           // seconds
  fadeOut: number;          // seconds
  fadeCurve: 'linear' | 'equal-power' | 's-curve';
  gain: number;             // 0-1
  label: string;
  sectionLabel?: SectionLabel;  // structural anchor — future: section matching, quantize, repair
  color?: string;
  stretchRatio: number;     // tempo ratio (1.0 = native); pitch-preserving via SoundTouch
  conformToProjectBpm?: boolean; // when true, stretchRatio tracks grid BPM changes
}

export interface WarpMarker {
  id: string;
  clipId: string;
  position: number;         // seconds in clip
  warpTarget: number;       // target position in seconds
}

export interface Project {
  id: string;
  name: string;
  bpm: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  tracks: Omit<AudioTrack, 'file' | 'audioBuffer' | 'waveformData'>[];
  clips: Clip[];
  arrangementClips: Clip[];
  warpMarkers: WarpMarker[];
  zoomLevel: number;
  scrollPosition: number;
  segmentMode: SegmentMode;  // bars per segment
  createdAt: string;
  updatedAt: string;
}

export type SegmentMode = 4 | 8 | 16;
export type PlaybackState = 'stopped' | 'playing' | 'paused';
export type ToolMode = 'select' | 'slip' | 'warp' | 'split';
export type BpmSource = 'auto' | 'tap' | 'manual';
export type SnapResolution = 'bar' | 'beat' | '1/2-beat' | '1/4-beat';
