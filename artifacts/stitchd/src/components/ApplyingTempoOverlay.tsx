import React from 'react';
import { useProjectStore } from '../store/useProjectStore';

/**
 * Full-screen overlay shown while the audio engine is rendering a tempo
 * change. Driven by `isApplyingTempo` in the store — set true by the
 * APPLY TEMPO handlers, cleared in schedulePlayback's finally block.
 *
 * Visual: dark translucent backdrop with a centered card containing a
 * staggered cyan-bar pulse (evokes a waveform / metronome) and a short
 * uppercase label. TETHR signal-cyan accents only — no loud color, no
 * spinner clichés.
 */
export function ApplyingTempoOverlay() {
  const isApplyingTempo = useProjectStore(s => s.isApplyingTempo);
  const bpm = useProjectStore(s => s.bpm);

  if (!isApplyingTempo) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-auto"
      style={{
        background: 'radial-gradient(ellipse at center, rgba(10, 12, 16, 0.78) 0%, rgba(6, 8, 12, 0.92) 100%)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
      }}
      role="status"
      aria-live="polite"
      aria-label="Applying tempo changes"
    >
      <div
        className="flex flex-col items-center gap-6 px-10 py-7 border border-primary/35 bg-[#0e1117]/95 relative"
        style={{
          boxShadow:
            '0 0 48px hsl(176 82% 46% / 0.18), 0 0 0 1px hsl(258 60% 70% / 0.05) inset',
        }}
      >
        {/* Corner accents — subtle TETHR signature */}
        <span
          className="absolute top-0 left-0 w-3 h-3 border-t border-l border-primary/60"
          aria-hidden
        />
        <span
          className="absolute top-0 right-0 w-3 h-3 border-t border-r border-primary/60"
          aria-hidden
        />
        <span
          className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-primary/60"
          aria-hidden
        />
        <span
          className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-primary/60"
          aria-hidden
        />

        {/* Pulse bars — staggered waveform animation */}
        <div className="flex items-end gap-[5px] h-9" aria-hidden>
          {[0, 1, 2, 3, 4, 5, 6].map(i => (
            <span
              key={i}
              className="w-[3px] bg-primary"
              style={{
                animation: 'tethr-tempo-pulse 1.05s ease-in-out infinite',
                animationDelay: `${i * 0.11}s`,
                boxShadow: '0 0 6px hsl(176 82% 46% / 0.65)',
              }}
            />
          ))}
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-[0.32em] font-medium text-primary">
            Applying Tempo
          </span>
          <span className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/70 font-mono">
            {bpm.toFixed(1)} BPM · pitch-preserving render
          </span>
        </div>
      </div>

      <style>{`
        @keyframes tethr-tempo-pulse {
          0%, 100% { height: 18%; opacity: 0.45; }
          50%      { height: 100%; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
