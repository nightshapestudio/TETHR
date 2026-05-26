import React from 'react';
import { useProjectStore } from '../store/useProjectStore';

/**
 * Full-screen overlay shown while the audio engine is rendering a tempo
 * change. Driven by `isApplyingTempo` in the store — set true by the
 * APPLY TEMPO handlers, cleared in schedulePlayback's finally block.
 *
 * Visual direction: a single signal scan reads as engineering status, not
 * generic loader chrome. No rainbow bars, no glow fog.
 */
export function ApplyingTempoOverlay() {
  const isApplyingTempo = useProjectStore(s => s.isApplyingTempo);
  const bpm = useProjectStore(s => s.bpm);

  if (!isApplyingTempo) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-auto"
      style={{
        background: 'rgba(4, 6, 10, 0.82)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
      role="status"
      aria-live="polite"
      aria-label="Applying tempo correction"
    >
      <div
        className="relative flex flex-col items-center gap-7 px-14 py-9"
        style={{
          background: 'hsl(230 6% 5%)',
          border: '1px solid hsl(230 7% 14%)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.85)',
          minWidth: 320,
        }}
      >
        {/* Architectural corner marks */}
        {(
          [
            { top: -1, left: -1, borders: 'border-t border-l' },
            { top: -1, right: -1, borders: 'border-t border-r' },
            { bottom: -1, left: -1, borders: 'border-b border-l' },
            { bottom: -1, right: -1, borders: 'border-b border-r' },
          ] as const
        ).map((p, i) => (
          <span
            key={i}
            aria-hidden
            className={`absolute w-3 h-3 ${p.borders}`}
            style={{
              top: (p as any).top,
              left: (p as any).left,
              right: (p as any).right,
              bottom: (p as any).bottom,
              borderColor: 'hsl(258 80% 70%)',
            }}
          />
        ))}

        {/* Sweeping signal beam — single horizontal scan, no glow fog. */}
        <div className="relative h-[2px] w-[200px] overflow-hidden" aria-hidden>
          {/* Track */}
          <div
            className="absolute inset-0"
            style={{ background: 'hsl(258 40% 20% / 0.5)' }}
          />
          {/* Beam */}
          <div
            className="absolute top-0 bottom-0 w-[60px]"
            style={{
              animation: 'tethr-beam 1.5s cubic-bezier(0.65, 0, 0.35, 1) infinite',
              background:
                'linear-gradient(90deg, transparent 0%, hsl(var(--signal)) 50%, transparent 100%)',
            }}
          />
        </div>

        <div className="flex flex-col items-center gap-2">
          <span
            className="text-[12px] uppercase tracking-[0.34em]"
            style={{
              color: 'hsl(258 48% 76%)',
              fontFamily: 'var(--app-font-ui)',
              fontWeight: 700,
            }}
          >
            Applying tempo correction…
          </span>
          <span
            className="text-[9px] uppercase tracking-[0.24em]"
            style={{
              color: 'hsl(var(--text-mid))',
              fontFamily: 'var(--app-font-mono)',
            }}
          >
            {bpm.toFixed(1)} BPM · pitch-preserving
          </span>
        </div>
      </div>

      <style>{`
        @keyframes tethr-beam {
          0%   { left: -60px; }
          100% { left: 200px; }
        }
      `}</style>
    </div>
  );
}
