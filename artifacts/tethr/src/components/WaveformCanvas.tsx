import React, { useRef } from 'react';
import { useWaveformRenderer } from '../hooks/useWaveformRenderer';

interface WaveformCanvasProps {
  waveformData: Float32Array | null;
  color: string;
  pixelsPerSecond: number;
  scrollOffset: number;
  duration: number;
  width: number;
  height: number;
  showGrid?: boolean;
  bpm?: number;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
}

export function WaveformCanvas({
  waveformData,
  color,
  pixelsPerSecond,
  scrollOffset,
  duration,
  width,
  height,
  showGrid,
  bpm,
  className = '',
  onClick,
  onDoubleClick,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useWaveformRenderer({
    canvasRef,
    waveformData,
    color,
    pixelsPerSecond,
    scrollOffset,
    duration,
    width,
    height,
    showGrid,
    bpm,
  });

  return (
    <canvas
      ref={canvasRef}
      className={`block select-none ${className}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    />
  );
}
