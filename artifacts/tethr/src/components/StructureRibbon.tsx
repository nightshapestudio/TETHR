import React, { useCallback } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import type { AudioTrack, StructureSegment } from '../types/audio';

interface StructureRibbonProps {
  track: AudioTrack;
  trackIndex?: number;
  trackCount?: number;
  pixelsPerSecond: number;
  scrollOffset: number;
  containerWidth: number;
}

/**
 * Cinematic section overlay — a thin band that sits between the time ruler
 * and waveform lanes, showing heuristically-detected song regions for the
 * focused source track.
 *
 * Coordinates: source seconds, same space the waveform canvas uses.
 *
 * Click toggles a section mute on the source track. Replacement/swapping can
 * build from this same source-section map later without inventing UI now.
 */
export function StructureRibbon({
  track,
  trackIndex = 0,
  trackCount = 1,
  pixelsPerSecond,
  scrollOffset,
  containerWidth,
}: StructureRibbonProps) {
  const toggleSectionMute = useProjectStore(s => s.toggleSectionMute);

  const segments = track.structureSegments ?? [];
  const hasSegments = segments.length > 0;
  const sourceLabel = trackCount > 1 ? `SRC ${String.fromCharCode(65 + trackIndex)}` : 'SRC';

  // Single gesture — click toggles mute on the section. What you see is
  // what plays AND what exports. No alt-click side path, no arrangement-lane
  // round-trip, no hidden routing.
  const handleSegmentClick = useCallback((seg: StructureSegment) => {
    toggleSectionMute(track.id, { start: seg.start, end: seg.end });
  }, [toggleSectionMute, track.id]);

  // True if the section is currently muted.
  const isMuted = (seg: StructureSegment): boolean => {
    return (track.sectionMutes || []).some(
      m => Math.abs(m.start - seg.start) < 0.05
        && Math.abs(m.end - seg.end) < 0.05,
    );
  };

  return (
    <div className="h-8 flex border-b border-border relative z-20" style={{ background: 'hsl(240 7% 6%)' }}>
      {/* Header column — matches track-row 100px gutter so segments align with waveforms */}
      <div className="w-[100px] shrink-0 border-r border-border px-2 flex flex-col justify-center gap-0.5" style={{ background: 'hsl(240 8% 5%)' }}>
        <span
          className="text-[8px] uppercase tracking-[0.20em] leading-none"
          style={{
            color: 'hsl(var(--text-high))',
            fontFamily: 'var(--app-font-ui)',
            fontWeight: 700,
          }}
        >
          Sections
        </span>
        <span
          className="text-[7px] uppercase tracking-[0.16em] leading-none"
          style={{ color: 'hsl(var(--text-mid))', fontFamily: 'var(--app-font-mono)' }}
        >
          {sourceLabel}
        </span>
      </div>

      {/* Segments */}
      <div className="flex-1 relative overflow-hidden">
        {!hasSegments && (
          <div className="absolute inset-0 flex items-center px-3">
            <span
              className="text-[9px] uppercase tracking-[0.18em]"
              style={{ color: 'hsl(var(--text-mid))', fontFamily: 'var(--app-font-ui)', fontWeight: 700 }}
            >
              No sections detected yet
            </span>
          </div>
        )}

        {hasSegments && segments.map((seg, i) => {
          const x = (seg.start - scrollOffset) * pixelsPerSecond;
          const w = Math.max(2, (seg.end - seg.start) * pixelsPerSecond);
          if (x + w < 0 || x > containerWidth) return null;

          const muted = isMuted(seg);
          const tone = energyTone(seg.energy);
          const label = formatSegmentLabel(seg.label, i);

          return (
            <button
              key={`${label}-${i}`}
              type="button"
              onClick={() => handleSegmentClick(seg)}
              title={muted
                ? `${label} · MUTED · click to unmute`
                : `${label} · ${(seg.end - seg.start).toFixed(1)}s — click to mute`}
              className="absolute top-0 bottom-0 group cursor-pointer transition-all select-none hover:bg-white/[0.025]"
              style={{
                left: x,
                width: w,
                background: 'transparent',
                opacity: muted ? 0.5 : 1,
              }}
            >
              {/* Left blade — the only colored element. */}
              <span
                aria-hidden
                className="absolute top-0 bottom-0 left-0 transition-all"
                style={{
                  width: muted ? 1 : 2,
                  background: muted ? 'hsl(230 8% 22%)' : tone.edge,
                }}
              />

              {/* Diagonal strike-through pattern when muted */}
              {muted && (
                <span
                  aria-hidden
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(135deg, transparent 0, transparent 5px, hsl(230 8% 12%) 5px, hsl(230 8% 12%) 6px)',
                  }}
                />
              )}

              {/* Label */}
              <span
                className="absolute top-1/2 -translate-y-1/2 left-3 text-[9px] uppercase tracking-[0.18em] whitespace-nowrap pointer-events-none"
                style={{
                  color: muted ? 'hsl(var(--text-low))' : tone.label,
                  textDecoration: muted ? 'line-through' : 'none',
                  fontFamily: 'var(--app-font-ui)',
                  fontWeight: 700,
                }}
              >
                {label}
              </span>

              {/* MUTED badge — right-aligned, only when muted */}
              {muted && (
                <span
                  className="absolute top-1/2 -translate-y-1/2 right-2 text-[7px] uppercase tracking-[0.20em] pointer-events-none"
                  style={{ color: 'hsl(var(--text-mid))', fontFamily: 'var(--app-font-ui)', fontWeight: 700 }}
                >
                  MUTE
                </span>
              )}

            </button>
          );
        })}
      </div>

      {/* Bottom seam — thin neutral hairline, restrained. */}
      <span aria-hidden className="absolute bottom-0 left-[100px] right-0 h-px pointer-events-none" style={{ background: 'hsl(220 18% 11%)' }} />
    </div>
  );
}

function formatSegmentLabel(label: string | undefined, index: number): string {
  const clean = (label || '').trim();
  if (!clean) return `Segment ${String(index + 1).padStart(2, '0')}`;

  return clean
    .replace(/^BREAKDOWN\b/i, 'Bridge')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Energy-tier visual tones — surfaces are matte graphite and segments read
 * as dark hardware slots with a single accent line, not colorful blocks.
 */
function energyTone(energy: 'low' | 'mid' | 'high') {
  if (energy === 'high') {
    // CHORUS / peak - brightest ultraviolet edge, cold high-emphasis label
    return {
      edge: 'hsl(268 95% 72%)',
      label: 'hsl(224 24% 78%)',
    };
  }
  if (energy === 'mid') {
    // VERSE - lavender edge, cool steel label
    return {
      edge: 'hsl(240 100% 70%)',
      label: 'hsl(224 20% 72%)',
    };
  }
  // BREAKDOWN / low — dim graphite edge, dimmer label
  return {
    edge: 'hsl(228 18% 40%)',
    label: 'hsl(224 16% 62%)',
  };
}
