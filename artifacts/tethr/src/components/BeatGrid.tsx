import React from 'react';

interface BeatGridProps {
  width: number;
  height: number;
  bpm: number;
  zoom: number;
  scrollOffset: number;
  visibleDuration: number;
  className?: string;
}

export function BeatGrid({ width, height, bpm, zoom, scrollOffset, visibleDuration, className = '' }: BeatGridProps) {
  if (bpm <= 0 || visibleDuration <= 0) return null;

  const beatsPerSecond = bpm / 60;
  const secondsPerBeat = 1 / beatsPerSecond;
  const pixelsPerSecond = width / visibleDuration;

  const firstVisibleBeat = Math.floor(scrollOffset / secondsPerBeat);
  const lastVisibleBeat = Math.ceil((scrollOffset + visibleDuration) / secondsPerBeat);

  const lines = [];

  for (let i = firstVisibleBeat; i <= lastVisibleBeat; i++) {
    const beatTime = i * secondsPerBeat;
    const x = (beatTime - scrollOffset) * pixelsPerSecond;

    if (x >= 0 && x <= width) {
      const isBar = i % 4 === 0;
      lines.push(
        <line
          key={i}
          x1={x}
          y1={0}
          x2={x}
          y2={height}
          stroke={isBar ? 'hsl(258 50% 62% / 0.10)' : 'rgba(255,255,255,0.045)'}
          strokeWidth={isBar ? 1 : 0.5}
        />
      );
    }
  }

  return (
    <svg width={width} height={height} className={`pointer-events-none absolute inset-0 ${className}`}>
      {lines}
    </svg>
  );
}
