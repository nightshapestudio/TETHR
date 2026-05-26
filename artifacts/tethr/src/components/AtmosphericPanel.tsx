import React from 'react';

/**
 * Atmospheric texture only — pure neutral. No colored radial blooms.
 * Earlier versions floated violet/cyan/periwinkle washes over the UI,
 * which read as "purple fog." Now this layer contributes scan lines and
 * subtle grain only, so dark surfaces stay neutral graphite. Color comes
 * from accents (typography, edges, focus rings), not from atmosphere.
 */
export function AtmosphericPanel({ className = '' }: { className?: string }) {
  return (
    <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`}>
      {/* Architectural scan lines — neutral, very subtle */}
      <div
        className="absolute inset-0 opacity-[0.30]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 32px, hsl(230 8% 22% / 0.025) 32px, hsl(230 8% 22% / 0.025) 33px)',
        }}
      />
      {/* Grain dither — prevents banding without adding hue */}
      <div
        className="absolute inset-0 opacity-[0.18] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`,
          backgroundSize: '128px 128px',
        }}
      />
    </div>
  );
}
