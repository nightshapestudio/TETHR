import React from 'react';

/** Layered gradients + noise dither to avoid banding in near-black UI regions. */
export function AtmosphericPanel({ className = '' }: { className?: string }) {
  return (
    <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`}>
      <div
        className="absolute inset-0"
        style={{
          background: [
            'radial-gradient(ellipse 45% 38% at 50% 42%, hsl(255 100% 71% / 0.07) 0%, transparent 68%)',
            'radial-gradient(ellipse 55% 45% at 48% 52%, hsl(232 100% 74% / 0.05) 0%, transparent 72%)',
            'radial-gradient(ellipse 35% 28% at 50% 50%, hsl(186 100% 68% / 0.035) 0%, transparent 65%)',
          ].join(', '),
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.45]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 28px, hsl(232 40% 70% / 0.018) 28px, hsl(232 40% 70% / 0.018) 29px)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.22] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`,
          backgroundSize: '128px 128px',
        }}
      />
    </div>
  );
}
