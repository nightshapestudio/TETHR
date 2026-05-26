import React, { useState, useCallback } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { ClipBlock } from './ClipBlock';

interface ArrangementLaneProps {
  width: number;
  height: number;
  pixelsPerSecond: number;
  scrollOffset: number;
}

interface ContextMenu {
  x: number;
  y: number;
  clipId: string;
}

export function ArrangementLane({ width, height, pixelsPerSecond, scrollOffset }: ArrangementLaneProps) {
  const { arrangementClips, selectedClipId, selectClip, removeArrangementClip, duplicateArrangementClip } = useProjectStore();
  const selectedClip = selectedClipId ? arrangementClips.find(c => c.id === selectedClipId) : null;
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, clipId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, clipId });
  }, []);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  const handleDelete = useCallback(() => {
    if (contextMenu) {
      removeArrangementClip(contextMenu.clipId);
      closeMenu();
    }
  }, [contextMenu, removeArrangementClip, closeMenu]);

  const handleDuplicate = useCallback(() => {
    if (contextMenu) {
      duplicateArrangementClip(contextMenu.clipId);
      closeMenu();
    }
  }, [contextMenu, duplicateArrangementClip, closeMenu]);

  const handleAuditionFromMenu = useCallback(() => {
    if (!contextMenu) return;
    const clip = arrangementClips.find(c => c.id === contextMenu.clipId);
    if (!clip) return;
    closeMenu();
    selectClip(contextMenu.clipId);
    // Trigger via store — SeamAuditionButton would do this, we replicate it here
    const { bpm, triggerPlay } = useProjectStore.getState();
    const secondsPerBar = bpm > 0 ? (60 / bpm) * 4 : 2;
    const regionStart = Math.max(0, clip.timelinePosition - secondsPerBar * 2);
    const regionEnd = clip.timelinePosition + clip.sourceDuration + secondsPerBar * 2;
    useProjectStore.setState({
      isLooping: true,
      loopRegion: { start: regionStart, end: regionEnd },
    });
    triggerPlay(regionStart);
  }, [contextMenu, arrangementClips, closeMenu, selectClip]);

  return (
    <>
      <div className="h-[120px] flex border-t border-t-primary/20 bg-background mt-4 relative z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.3)]">
        <div className="w-[100px] shrink-0 border-r border-border bg-[#111111] p-2 flex flex-col justify-center relative z-10">
          <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground font-medium">ARRANGEMENT</span>
          <span className="text-[8px] font-mono text-muted-foreground/40 mt-1">{arrangementClips.length} clip{arrangementClips.length !== 1 ? 's' : ''}</span>
        </div>

        <div
          className="flex-1 relative overflow-hidden"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              selectClip(null);
              closeMenu();
            }
          }}
          onClick={closeMenu}
        >
          {/* Replace mode banner */}
          {selectedClip && (
            <div
              className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-1 pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, hsl(var(--primary)/0.12) 0%, transparent 100%)',
                borderBottom: '1px solid hsl(var(--primary)/0.25)',
              }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: selectedClip.color || 'hsl(var(--primary))' }}
                />
                <span className="text-[9px] uppercase tracking-[0.15em] font-medium text-primary">
                  REPLACE MODE
                </span>
                <span className="text-[8px] text-muted-foreground font-mono truncate max-w-[180px]">
                  → {selectedClip.label}
                </span>
              </div>
              <span className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground/60 pointer-events-auto cursor-pointer hover:text-foreground transition-colors" onClick={(e) => { e.stopPropagation(); selectClip(null); }}>
                ESC to cancel
              </span>
            </div>
          )}

          {/* Empty-state placeholder removed — the lane no longer mounts
              when arrangementClips is empty (see Timeline.tsx). */}

          {arrangementClips.map((clip) => (
            <div
              key={clip.id}
              className="absolute top-0 bottom-0"
              style={{
                left: `${(clip.timelinePosition - scrollOffset) * pixelsPerSecond}px`,
                width: `${Math.max(4, clip.sourceDuration * pixelsPerSecond)}px`,
              }}
              onContextMenu={(e) => handleContextMenu(e, clip.id)}
            >
              <ClipBlock
                clip={clip}
                isSelected={selectedClipId === clip.id}
                pixelsPerSecond={pixelsPerSecond}
                scrollOffset={scrollOffset}
                height={height}
                onClick={() => selectClip(clip.id)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Floating context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[100]"
            onPointerDown={closeMenu}
          />
          <div
            className="fixed z-[101] bg-[#101010] border border-border shadow-xl min-w-[160px] py-1"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full px-3 py-1.5 text-left text-[11px] uppercase tracking-[0.08em] text-foreground hover:bg-white/5 hover:text-primary transition-colors flex items-center gap-2"
              onClick={handleAuditionFromMenu}
            >
              <span className="text-primary/60">▶</span> Audition Seam
            </button>
            <button
              className="w-full px-3 py-1.5 text-left text-[11px] uppercase tracking-[0.08em] text-foreground hover:bg-white/5 transition-colors"
              onClick={handleDuplicate}
            >
              Duplicate
            </button>
            <div className="my-1 border-t border-border/50" />
            <button
              className="w-full px-3 py-1.5 text-left text-[11px] uppercase tracking-[0.08em] text-destructive hover:bg-destructive/10 transition-colors"
              onClick={handleDelete}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </>
  );
}
