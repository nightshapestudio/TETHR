import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { WaveformCanvas } from './WaveformCanvas';
import { BeatGrid } from './BeatGrid';
import { ArrangementLane } from './ArrangementLane';
import { snapForward } from '../lib/snapUtils';

export function Timeline() {
  const {
    tracks,
    arrangementClips,
    selectedClipId,
    bpm,
    segmentMode,
    zoomLevel,
    scrollPosition,
    setScroll,
    playheadPosition,
    setPlayheadPosition,
    importTrack,
    addArrangementClip,
    updateArrangementClip,
    playbackState,
    snapEnabled,
    snapResolution,
    snapGuidePosition,
  } = useProjectStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setContainerWidth(entries[0].contentRect.width);
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const baseVisibleDuration = 30;
  const visibleDuration = baseVisibleDuration / zoomLevel;
  const pixelsPerSecond = containerWidth / visibleDuration;

  const maxTrackDuration = tracks.length > 0 ? Math.max(...tracks.map(t => t.duration)) : 0;
  const maxArrangementEnd = arrangementClips.length > 0
    ? Math.max(...arrangementClips.map(c => c.timelinePosition + c.sourceDuration))
    : 0;
  const totalDuration = Math.max(maxTrackDuration, maxArrangementEnd, 60);

  // Non-passive wheel listener so preventDefault works for both zoom and pan
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoomLevel: zl, scrollPosition: sp, setScroll: scroll, setZoom } = useProjectStore.getState();

      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY > 0 ? 0.85 : 1.18;
        setZoom(zl * factor);
      } else {
        const dur = baseVisibleDuration / zl;
        const pps = containerWidth / dur;
        const maxScroll = Math.max(0, totalDuration - dur);
        const delta = (e.deltaX + e.deltaY) / pps;
        scroll(Math.max(0, Math.min(maxScroll, sp + delta)));
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerWidth, totalDuration]);

  // Auto-scroll playhead into view
  useEffect(() => {
    if (playbackState !== 'playing') return;
    const margin = visibleDuration * 0.15;
    if (playheadPosition > scrollPosition + visibleDuration - margin) {
      setScroll(playheadPosition - margin);
    } else if (playheadPosition < scrollPosition) {
      setScroll(Math.max(0, playheadPosition - margin));
    }
  }, [playheadPosition, playbackState]);

  const handleRulerClick = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - 100;
    if (x < 0) return;
    const time = Math.max(0, scrollPosition + x / pixelsPerSecond);
    setPlayheadPosition(time);
    if (playbackState === 'playing') {
      useProjectStore.getState().triggerPlay(time);
    }
  }, [scrollPosition, pixelsPerSecond, playbackState, setPlayheadPosition]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      const files = Array.from(e.dataTransfer.files).filter(f =>
        f.type.startsWith('audio/') ||
        /\.(wav|mp3|m4a|aiff|aif)$/i.test(f.name)
      );
      for (const file of files) {
        await importTrack(file);
      }
    }
  }, [importTrack]);

  // Calculate insertion position: end of current arrangement (snap forward to next grid boundary)
  const getInsertPosition = useCallback(() => {
    const { arrangementClips: clips, snapEnabled: se, snapResolution: sr, bpm: b } = useProjectStore.getState();
    if (clips.length === 0) return 0;
    const rawEnd = Math.max(...clips.map(c => c.timelinePosition + c.sourceDuration));
    return snapForward(rawEnd, b, se, sr);
  }, []);

  const renderSegmentOverlay = useCallback((trackId: string, duration: number, color: string, trackName: string) => {
    if (bpm <= 0 || duration <= 0) return null;
    const secondsPerBar = (60 / bpm) * 4;
    const segmentDuration = secondsPerBar * segmentMode;
    const numSegments = Math.ceil(duration / segmentDuration);
    const segments = [];

    // Snapshot selected clip at render time (stable ref via getState inside handler)
    const isReplaceMode = !!selectedClipId;

    for (let i = 0; i < numSegments; i++) {
      const segStart = i * segmentDuration;
      const segEnd = Math.min((i + 1) * segmentDuration, duration);
      const segDuration = segEnd - segStart;
      const x = (segStart - scrollPosition) * pixelsPerSecond;
      const w = segDuration * pixelsPerSecond;

      if (x + w < 0 || x > containerWidth) continue;

      segments.push(
        <div
          key={i}
          data-testid={`segment-${trackId}-${i}`}
          className={`absolute top-0 bottom-0 border-r group cursor-pointer transition-colors ${
            isReplaceMode
              ? 'border-primary/30 hover:bg-primary/10'
              : 'border-primary/20 hover:bg-white/5'
          }`}
          style={{ left: x, width: w }}
          onClick={(e) => {
            e.stopPropagation();

            // Read fresh state at click time to avoid stale closure
            const { selectedClipId: selId, arrangementClips: clips } = useProjectStore.getState();
            const selectedClip = selId ? clips.find(c => c.id === selId) : null;

            if (selectedClip) {
              // REPLACE MODE — keep position, fades, gain; auto-stretch to fill old output duration
              const oldOutputDuration = selectedClip.sourceDuration / Math.max(0.05, selectedClip.stretchRatio);
              const newStretchRatio = Math.max(0.25, Math.min(4, segDuration / oldOutputDuration));

              updateArrangementClip(selectedClip.id, {
                trackId,
                sourceStart: segStart,
                sourceDuration: segDuration,
                slipOffset: 0,
                stretchRatio: newStretchRatio,
                // Clamp fades to new source duration
                fadeIn: Math.min(selectedClip.fadeIn, segDuration),
                fadeOut: Math.min(selectedClip.fadeOut, segDuration),
                // Preserve: timelinePosition, nudgeOffset, fadeCurve, gain, label gets updated
                label: `${trackName} – Seg ${i + 1}`,
                color,
              });
              // Clip stays selected (same id), no extra selectClip call needed
            } else {
              // APPEND MODE — add new clip at end of arrangement, snapped to grid
              const insertPos = getInsertPosition();
              addArrangementClip({
                id: crypto.randomUUID(),
                trackId,
                sourceStart: segStart,
                sourceDuration: segDuration,
                timelinePosition: insertPos,
                nudgeOffset: 0,
                slipOffset: 0,
                fadeIn: 0.05,
                fadeOut: 0.05,
                fadeCurve: 'equal-power',
                gain: 1.0,
                label: `${trackName} – Seg ${i + 1}`,
                color,
                stretchRatio: 1.0,
              });
            }
          }}
        >
          <div className={`absolute top-1 left-1 px-1 bg-black/80 border text-[9px] uppercase tracking-[0.08em] opacity-0 group-hover:opacity-100 truncate max-w-[calc(100%-8px)] pointer-events-none select-none ${
            isReplaceMode
              ? 'border-primary/60 text-primary'
              : 'border-border text-white/80'
          }`}>
            {isReplaceMode ? `REPLACE → SEG ${i + 1}` : `SEG ${i + 1}`}
          </div>
        </div>
      );
    }
    return segments;
  }, [bpm, segmentMode, scrollPosition, pixelsPerSecond, containerWidth, selectedClipId, addArrangementClip, updateArrangementClip, getInsertPosition]);

  const rulerMarkers = () => {
    const markers = [];
    const step = visibleDuration > 120 ? 10 : visibleDuration > 60 ? 5 : visibleDuration > 20 ? 2 : 1;
    const firstMark = Math.floor(scrollPosition / step) * step;
    const lastMark = scrollPosition + visibleDuration + step;

    for (let t = firstMark; t <= lastMark; t += step) {
      const x = (t - scrollPosition) * pixelsPerSecond + 100;
      if (x < 100 || x > containerWidth + 100) continue;

      const barNum = bpm > 0 ? Math.round(t / ((60 / bpm) * 4)) + 1 : null;

      markers.push(
        <div
          key={t}
          className="absolute top-0 bottom-0 border-l border-border/40 flex flex-col justify-start pt-0.5 pl-1"
          style={{ left: x }}
        >
          <span className="text-[9px] font-mono text-muted-foreground leading-none">
            {barNum !== null ? `B${barNum}` : `${t}s`}
          </span>
          <span className="text-[8px] font-mono text-muted-foreground/40 leading-none mt-0.5">
            {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, '0')}
          </span>
        </div>
      );
    }
    return markers;
  };

  const playheadX = 100 + (playheadPosition - scrollPosition) * pixelsPerSecond;
  const playheadVisible = playheadX >= 100 && playheadX <= containerWidth + 100;

  // Snap guide X position in pixels (null when not dragging)
  const snapGuideX = snapGuidePosition !== null
    ? 100 + (snapGuidePosition - scrollPosition) * pixelsPerSecond
    : null;
  const snapGuideVisible = snapGuideX !== null && snapGuideX >= 100 && snapGuideX <= containerWidth + 100;

  return (
    <div
      ref={containerRef}
      className={`flex-1 flex flex-col bg-background overflow-hidden relative ${isDragging ? 'ring-1 ring-inset ring-primary/40' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { if (!containerRef.current?.contains(e.relatedTarget as Node)) setIsDragging(false); }}
      onDrop={handleDrop}
    >
      {/* Ruler */}
      <div
        className="h-8 bg-[#0b0c10] border-b border-border flex shrink-0 cursor-crosshair select-none relative"
        onClick={handleRulerClick}
      >
        <div className="w-[100px] shrink-0 border-r border-border bg-[#0b0c10] flex items-center px-2">
          <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground font-medium">TIMELINE</span>
        </div>
        <div className="flex-1 relative overflow-hidden">
          {rulerMarkers()}
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden relative">
        {tracks.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-4">
            <div className="w-16 h-16 border border-dashed border-muted-foreground/30 flex items-center justify-center">
              <span className="text-2xl text-muted-foreground/40">+</span>
            </div>
            <div className="text-center">
              <p className="text-[9px] uppercase tracking-[0.12em] font-medium text-foreground/60 mb-1">DROP AUDIO FILES</p>
              <p className="text-xs text-muted-foreground/50 font-mono">WAV, MP3, M4A, AIFF</p>
            </div>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute top-0 bottom-0 pointer-events-none z-0" style={{ left: 100, right: 0 }}>
              <BeatGrid
                width={containerWidth - 100}
                height={tracks.length * 80 + 120}
                bpm={bpm}
                zoom={zoomLevel}
                scrollOffset={scrollPosition}
                visibleDuration={visibleDuration}
              />
            </div>

            {tracks.map((track, idx) => (
              <div
                key={track.id}
                data-testid={`track-row-${track.id}`}
                className="h-20 flex border-b border-border/50 relative z-10"
                style={{ backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.1)' }}
              >
                <div className="w-[100px] shrink-0 border-r border-border/80 bg-[#0c0d12] px-2 py-1.5 flex flex-col justify-center">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] uppercase tracking-wide font-medium truncate text-foreground/80 leading-tight">{track.name}</span>
                  </div>
                  <div className="flex gap-1">
                    {track.isReference && (
                      <div className="flex items-center gap-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        <span className="text-[8px] text-primary tracking-[0.1em] uppercase">MASTER</span>
                      </div>
                    )}
                    {track.isMuted && (
                      <div className="flex items-center gap-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
                        <span className="text-[8px] text-destructive tracking-[0.1em] uppercase">MUTED</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 relative overflow-hidden">
                  <WaveformCanvas
                    waveformData={track.waveformData}
                    color={track.isReference ? 'hsl(195 70% 48% / 0.7)' : track.color}
                    pixelsPerSecond={pixelsPerSecond}
                    scrollOffset={scrollPosition}
                    duration={track.duration}
                    width={containerWidth - 100}
                    height={80}
                    className="absolute inset-0"
                  />
                  {renderSegmentOverlay(track.id, track.duration, track.color, track.name)}
                </div>
              </div>
            ))}

            <ArrangementLane
              width={containerWidth}
              height={120}
              pixelsPerSecond={pixelsPerSecond}
              scrollOffset={scrollPosition}
            />

            {/* Snap guide — cyan vertical line shown while dragging a clip */}
            {snapGuideVisible && (
              <div
                className="absolute inset-y-0 pointer-events-none z-40"
                style={{
                  left: snapGuideX!,
                  width: 1,
                  background: 'hsl(176 82% 60% / 0.65)',
                  boxShadow: '0 0 5px hsl(176 82% 60% / 0.45)',
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Playhead — spans full height including ruler */}
      {playheadVisible && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none z-50"
          style={{ left: playheadX, width: 1, backgroundColor: 'hsl(var(--primary))', opacity: 0.9 }}
        >
          <div
            className="absolute top-0"
            style={{
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '7px solid hsl(var(--primary))',
              left: -4,
              filter: 'drop-shadow(0 0 3px hsl(var(--primary) / 0.8))',
            }}
          />
        </div>
      )}

      {isDragging && (
        <div className="absolute inset-0 pointer-events-none z-40 flex items-center justify-center backdrop-blur-[2px]">
          <div className="bg-[#0b0c10]/90 border border-primary px-8 py-4 text-primary text-[11px] uppercase tracking-[0.2em] font-medium shadow-[0_0_20px_hsl(var(--primary)/0.2)]">
            DROP TO IMPORT
          </div>
        </div>
      )}
    </div>
  );
}
