import React, { useRef, useCallback } from 'react';
import { Clip } from '../types/audio';
import { useProjectStore } from '../store/useProjectStore';
import { snapPosition } from '../lib/snapUtils';
import { stretchedTimelineDuration } from '../lib/timeStretch';
import { getSectionShort } from '../lib/sectionLabels';

interface ClipBlockProps {
  clip: Clip;
  isSelected: boolean;
  pixelsPerSecond: number;
  scrollOffset: number;
  height: number;
  onClick: () => void;
}

type DragMode = 'move' | 'trim-left' | 'trim-right';

const MIN_CLIP_DURATION = 0.05;
const HANDLE_WIDTH = 8;

export function ClipBlock({ clip, isSelected, pixelsPerSecond, scrollOffset, height, onClick }: ClipBlockProps) {
  const updateArrangementClip = useProjectStore(s => s.updateArrangementClip);
  const splitArrangementClip = useProjectStore(s => s.splitArrangementClip);
  const setSnapGuidePosition = useProjectStore(s => s.setSnapGuidePosition);
  const toolMode = useProjectStore(s => s.toolMode);
  const bpm = useProjectStore(s => s.bpm);
  const snapEnabled = useProjectStore(s => s.snapEnabled);
  const snapResolution = useProjectStore(s => s.snapResolution);
  const track = useProjectStore(s => s.tracks.find(t => t.id === clip.trackId));

  const dragStart = useRef<{
    mouseX: number;
    clipPosition: number;
    sourceStart: number;
    sourceDuration: number;
    mode: DragMode;
  } | null>(null);

  const x = (clip.timelinePosition - scrollOffset) * pixelsPerSecond;
  const w = Math.max(4, stretchedTimelineDuration(clip.sourceDuration, clip.stretchRatio || 1) * pixelsPerSecond);

  const getLocalOffset = (clientX: number, currentTarget: HTMLDivElement) => {
    const rect = currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(rect.width, clientX - rect.left));
  };

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();

    const localX = getLocalOffset(e.clientX, e.currentTarget);

    if (toolMode === 'split') {
      const splitOffset = localX / pixelsPerSecond;
      splitArrangementClip(clip.id, splitOffset);
      return;
    }

    let mode: DragMode = 'move';
    if (localX <= HANDLE_WIDTH) mode = 'trim-left';
    if (localX >= e.currentTarget.getBoundingClientRect().width - HANDLE_WIDTH) mode = 'trim-right';

    dragStart.current = {
      mouseX: e.clientX,
      clipPosition: clip.timelinePosition,
      sourceStart: clip.sourceStart,
      sourceDuration: clip.sourceDuration,
      mode,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [clip.id, clip.sourceDuration, clip.sourceStart, clip.timelinePosition, onClick, pixelsPerSecond, splitArrangementClip, toolMode]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    e.stopPropagation();

    const deltaX = e.clientX - dragStart.current.mouseX;
    const deltaSec = deltaX / pixelsPerSecond;
    const trackDuration = track?.duration ?? Number.POSITIVE_INFINITY;
    const shiftHeld = e.shiftKey;

    if (dragStart.current.mode === 'move') {
      const rawPosition = Math.max(0, dragStart.current.clipPosition + deltaSec);
      const newPosition = snapPosition(rawPosition, bpm, snapEnabled, snapResolution, shiftHeld);
      updateArrangementClip(clip.id, { timelinePosition: newPosition });
      // Emit snap guide so Timeline can draw the cyan guide line
      setSnapGuidePosition(newPosition);
      return;
    }

    if (dragStart.current.mode === 'trim-left') {
      const maxTrim = dragStart.current.sourceDuration - MIN_CLIP_DURATION;
      const trimAmount = Math.max(-dragStart.current.sourceStart, Math.min(maxTrim, deltaSec));
      const newSourceStart = Math.max(0, dragStart.current.sourceStart + trimAmount);
      const newDuration = Math.max(MIN_CLIP_DURATION, dragStart.current.sourceDuration - trimAmount);
      const rawPosition = Math.max(0, dragStart.current.clipPosition + trimAmount);
      const newTimelinePosition = snapPosition(rawPosition, bpm, snapEnabled, snapResolution, shiftHeld);
      updateArrangementClip(clip.id, {
        sourceStart: newSourceStart,
        sourceDuration: newDuration,
        timelinePosition: newTimelinePosition,
        fadeIn: Math.min(clip.fadeIn, newDuration),
        fadeOut: Math.min(clip.fadeOut, newDuration),
      });
      return;
    }

    // trim-right: snap the clip's right edge
    const rawEnd = dragStart.current.clipPosition + dragStart.current.sourceDuration + deltaSec;
    const snappedEnd = snapPosition(rawEnd, bpm, snapEnabled, snapResolution, shiftHeld);
    const snappedDuration = snappedEnd - dragStart.current.clipPosition;
    const maxRightDuration = Math.max(MIN_CLIP_DURATION, trackDuration - dragStart.current.sourceStart);
    const newDuration = Math.max(MIN_CLIP_DURATION, Math.min(maxRightDuration, snappedDuration));
    updateArrangementClip(clip.id, {
      sourceDuration: newDuration,
      fadeIn: Math.min(clip.fadeIn, newDuration),
      fadeOut: Math.min(clip.fadeOut, newDuration),
    });
  }, [bpm, clip.fadeIn, clip.fadeOut, clip.id, pixelsPerSecond, snapEnabled, snapResolution, setSnapGuidePosition, track?.duration, updateArrangementClip]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    dragStart.current = null;
    setSnapGuidePosition(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  }, [setSnapGuidePosition]);

  // All hooks are above — safe to early-return now
  const containerWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  if (x + w < 0 || x > containerWidth) return null;

  const clipColor = clip.color || 'hsl(258 60% 62%)';
  const fadeInPx = clip.fadeIn * pixelsPerSecond;
  const fadeOutPx = clip.fadeOut * pixelsPerSecond;

  const withAlpha = (c: string, a: number) => {
    const stripped = c.replace(/\s*\/\s*[\d.]+\)\s*$/, ')').replace(/\)\s*$/, '');
    return `${stripped} / ${a})`;
  };

  const cursorClass = toolMode === 'split' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing';

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`absolute top-0 bottom-0 select-none overflow-hidden ${cursorClass} ${
        isSelected ? 'z-20' : 'z-10'
      } hover:brightness-110 group`}
      style={{
        left: `${x}px`,
        width: `${w}px`,
        backgroundColor: withAlpha(clipColor, 0.12),
        borderLeft: `2px solid ${isSelected ? 'hsl(176 82% 52%)' : clipColor}`,
        borderTop: isSelected ? '1px solid hsl(176 82% 52%)' : '1px solid transparent',
        borderRight: isSelected ? '1px solid hsl(176 82% 52%)' : '1px solid transparent',
        borderBottom: isSelected ? '1px solid hsl(176 82% 52%)' : '1px solid transparent',
        boxShadow: isSelected
          ? '0 0 0 1px hsl(176 82% 52% / 0.28), inset 0 0 14px hsl(176 82% 46% / 0.07), 0 0 20px hsl(176 82% 46% / 0.14)'
          : undefined,
      }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 bg-white/0 group-hover:bg-white/10" title="Trim start" />
      <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 bg-white/0 group-hover:bg-white/10" title="Trim end" />

      {toolMode === 'split' && (
        <div className="absolute inset-0 pointer-events-none border border-primary/60 bg-primary/5 z-10" />
      )}

      <div className="absolute top-0 left-0 right-0 h-4 bg-black/40 border-b border-white/5 flex items-center justify-between px-1.5 gap-1 pointer-events-none">
        {getSectionShort(clip.sectionLabel) && (
          <span className="text-[8px] uppercase tracking-[0.14em] text-primary/70 font-semibold shrink-0 leading-none">
            {getSectionShort(clip.sectionLabel)}
          </span>
        )}
        <span className={`text-[9px] uppercase tracking-[0.08em] truncate leading-none ${clip.sectionLabel ? 'text-foreground/45 text-right flex-1' : 'text-foreground/80'}`}>
          {clip.label}
        </span>
      </div>

      {clip.fadeIn > 0 && fadeInPx > 1 && (
        <svg
          className="absolute top-4 left-0 bottom-0 pointer-events-none"
          width={fadeInPx}
          height={height - 16}
          viewBox={`0 0 ${fadeInPx} ${height - 16}`}
          preserveAspectRatio="none"
        >
          <polygon
            points={`0,${height - 16} ${fadeInPx},0 0,0`}
            fill="rgba(255,255,255,0.15)"
          />
        </svg>
      )}

      {clip.fadeOut > 0 && fadeOutPx > 1 && (
        <svg
          className="absolute top-4 right-0 bottom-0 pointer-events-none"
          width={fadeOutPx}
          height={height - 16}
          viewBox={`0 0 ${fadeOutPx} ${height - 16}`}
          preserveAspectRatio="none"
        >
          <polygon
            points={`0,0 ${fadeOutPx},${height - 16} ${fadeOutPx},0`}
            fill="rgba(255,255,255,0.15)"
          />
        </svg>
      )}
    </div>
  );
}
