import { useEffect } from 'react';
import type { RefObject } from 'react';

interface WaveformRendererProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  waveformData: Float32Array | null;
  color: string;
  pixelsPerSecond: number;
  scrollOffset: number;
  duration: number;
  width: number;
  height: number;
  showGrid?: boolean;
  bpm?: number;
}

// Threshold above which a peak is rendered as a cyan transient spike
const TRANSIENT_THRESHOLD = 0.60;

export function useWaveformRenderer({
  canvasRef,
  waveformData,
  color,
  pixelsPerSecond,
  scrollOffset,
  duration,
  width,
  height,
  showGrid = false,
  bpm = 120,
}: WaveformRendererProps) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    if (showGrid && bpm > 0 && pixelsPerSecond > 0) {
      const secondsPerBeat = 60 / bpm;
      const visibleDuration = width / pixelsPerSecond;
      const firstBeat = Math.floor(scrollOffset / secondsPerBeat);
      const lastBeat = Math.ceil((scrollOffset + visibleDuration) / secondsPerBeat);

      for (let i = firstBeat; i <= lastBeat; i++) {
        const beatTime = i * secondsPerBeat;
        const x = (beatTime - scrollOffset) * pixelsPerSecond;
        if (x < 0 || x > width) continue;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        if (i % 4 === 0) {
          ctx.strokeStyle = 'hsl(258 50% 62% / 0.11)';
          ctx.lineWidth = 1;
        } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.lineWidth = 0.5;
        }
        ctx.stroke();
      }
    }

    if (!waveformData || waveformData.length === 0 || duration <= 0 || pixelsPerSecond <= 0) return;

    const visibleStart = scrollOffset;
    const visibleEnd = scrollOffset + width / pixelsPerSecond;

    const dataStartIndex = Math.max(0, Math.floor((visibleStart / duration) * waveformData.length) - 1);
    const dataEndIndex = Math.min(waveformData.length - 1, Math.ceil((visibleEnd / duration) * waveformData.length) + 1);

    const middleY = height / 2;

    // ── Waveform body fill ──
    ctx.beginPath();
    let started = false;
    for (let i = dataStartIndex; i <= dataEndIndex; i++) {
      const timeAtPoint = (i / waveformData.length) * duration;
      const x = (timeAtPoint - scrollOffset) * pixelsPerSecond;
      const amplitude = Math.min(1, waveformData[i]) * (middleY - 2);
      if (!started) {
        ctx.moveTo(x, middleY - amplitude);
        started = true;
      } else {
        ctx.lineTo(x, middleY - amplitude);
      }
    }
    for (let i = dataEndIndex; i >= dataStartIndex; i--) {
      const timeAtPoint = (i / waveformData.length) * duration;
      const x = (timeAtPoint - scrollOffset) * pixelsPerSecond;
      const amplitude = Math.min(1, waveformData[i]) * (middleY - 2);
      ctx.lineTo(x, middleY + amplitude);
    }
    ctx.closePath();

    // Strip any existing alpha from a color string
    const withAlpha = (c: string, a: number): string => {
      const stripped = c.replace(/\s*\/\s*[\d.]+\)\s*$/, ')').replace(/\)\s*$/, '');
      return `${stripped} / ${a})`;
    };

    // Vertical gradient fill — color body
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0,   withAlpha(color, 0.42));
    gradient.addColorStop(0.5, withAlpha(color, 0.60));
    gradient.addColorStop(1,   withAlpha(color, 0.42));
    ctx.fillStyle = gradient;
    ctx.fill();

    // Center line
    ctx.beginPath();
    ctx.moveTo(0, middleY);
    ctx.lineTo(width, middleY);
    ctx.strokeStyle = withAlpha(color, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── Top outline — crisp spectral edge ──
    ctx.beginPath();
    started = false;
    for (let i = dataStartIndex; i <= dataEndIndex; i++) {
      const timeAtPoint = (i / waveformData.length) * duration;
      const x = (timeAtPoint - scrollOffset) * pixelsPerSecond;
      const amplitude = Math.min(1, waveformData[i]) * (middleY - 2);
      if (!started) {
        ctx.moveTo(x, middleY - amplitude);
        started = true;
      } else {
        ctx.lineTo(x, middleY - amplitude);
      }
    }
    ctx.strokeStyle = withAlpha(color, 0.80);
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── Transient spikes — layered for depth ──
    // First pass: wide periwinkle halo (3px), low alpha — atmospheric energy.
    // Second pass: crisp cyan core (1px), high alpha — precise signal accent.
    // Together this reads as "alive light" instead of flat lines.
    for (let i = dataStartIndex; i <= dataEndIndex; i++) {
      const amp = waveformData[i];
      if (amp <= TRANSIENT_THRESHOLD) continue;

      const timeAtPoint = (i / waveformData.length) * duration;
      const x = (timeAtPoint - scrollOffset) * pixelsPerSecond;
      const amplitude = Math.min(1, amp) * (middleY - 2);
      const energy = (amp - TRANSIENT_THRESHOLD) / (1 - TRANSIENT_THRESHOLD); // 0–1
      const alpha = 0.32 + energy * 0.58;
      const haloAlpha = (0.08 + energy * 0.22);

      // Periwinkle halo (top) — wider, softer
      ctx.beginPath();
      ctx.moveTo(x, middleY - amplitude * 0.45);
      ctx.lineTo(x, middleY - amplitude);
      ctx.strokeStyle = `hsl(232 100% 74% / ${haloAlpha})`;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Periwinkle halo (bottom mirror)
      ctx.beginPath();
      ctx.moveTo(x, middleY + amplitude * 0.45);
      ctx.lineTo(x, middleY + amplitude);
      ctx.strokeStyle = `hsl(232 100% 74% / ${haloAlpha * 0.7})`;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Cyan core (top spike) — crisp
      ctx.beginPath();
      ctx.moveTo(x, middleY - amplitude * 0.55);
      ctx.lineTo(x, middleY - amplitude);
      ctx.strokeStyle = `hsl(180 60% 50% / ${alpha})`;
      ctx.lineWidth = 1;
      ctx.lineCap = 'butt';
      ctx.stroke();

      // Cyan core (bottom spike, slightly dimmer)
      ctx.beginPath();
      ctx.moveTo(x, middleY + amplitude * 0.55);
      ctx.lineTo(x, middleY + amplitude);
      ctx.strokeStyle = `hsl(180 60% 50% / ${alpha * 0.65})`;
      ctx.stroke();
    }

  }, [canvasRef, waveformData, color, pixelsPerSecond, scrollOffset, duration, width, height, showGrid, bpm]);
}
