import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { WaveformCanvas } from './WaveformCanvas';
import { BeatGrid } from './BeatGrid';
import { StructureRibbon } from './StructureRibbon';
import { snapForward } from '../lib/snapUtils';
import { conformTempoRatio, stretchedTimelineDuration } from '../lib/timeStretch';
import { AtmosphericPanel } from './AtmosphericPanel';

// Vertical lane sizing — session-only, per-track. Drag the handle at the
// bottom of a row to resize. Heights live in component state so they reset
// on reload (matches Phase 2 spec).
const DEFAULT_LANE_HEIGHT = 80;
const MIN_LANE_HEIGHT = 48;
const MAX_LANE_HEIGHT = 400;

export function Timeline() {
  const {
    tracks,
    arrangementClips,
    selectedClipId,
    selectedTrackId,
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
    selectTrack,
  } = useProjectStore();

  // Compute which track will play in source-only mode so we can badge it
  const sourcePlayTrackId = arrangementClips.length === 0
    ? (selectedTrackId || tracks.find(t => t.isReference)?.id || tracks[0]?.id || null)
    : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [isDragging, setIsDragging] = useState(false);

  // Click-to-import for the empty drop zone. Mirrors the LeftSidebar's
  // file-input flow so users don't HAVE to drag files onto the target.
  const handleFilePick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (
        file.type.startsWith('audio/') ||
        /\.(wav|mp3|m4a|aiff|aif)$/i.test(file.name)
      ) {
        await importTrack(file);
      }
    }
    // Reset so the same file can be re-picked later
    e.target.value = '';
  }, [importTrack]);
  // Per-track lane heights — session only. Missing entries fall back to DEFAULT.
  const [laneHeights, setLaneHeights] = useState<Record<string, number>>({});

  const getLaneHeight = useCallback((trackId: string): number => {
    return laneHeights[trackId] ?? DEFAULT_LANE_HEIGHT;
  }, [laneHeights]);

  const startLaneResize = useCallback((e: React.PointerEvent, trackId: string) => {
    // Don't let the drag bleed into other handlers (segment clicks, etc.)
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startHeight = laneHeights[trackId] ?? DEFAULT_LANE_HEIGHT;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientY - startY;
      const next = Math.max(MIN_LANE_HEIGHT, Math.min(MAX_LANE_HEIGHT, startHeight + delta));
      setLaneHeights(h => h[trackId] === next ? h : { ...h, [trackId]: next });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [laneHeights]);

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
    ? Math.max(...arrangementClips.map(c =>
        c.timelinePosition + stretchedTimelineDuration(c.sourceDuration, c.stretchRatio || 1)))
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
              const { tracks: allTracks, bpm: gridBpm } = useProjectStore.getState();
              const srcTrack = allTracks.find(t => t.id === trackId);
              const initialStretch = srcTrack?.estimatedBpm
                ? conformTempoRatio(srcTrack.estimatedBpm, gridBpm)
                : 1;
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
                stretchRatio: initialStretch,
                conformToProjectBpm: true,
              });
            }
          }}
        >
          <div className={`absolute top-1 left-1 px-1 bg-black/80 border text-[9px] uppercase tracking-[0.08em] opacity-0 group-hover:opacity-100 truncate max-w-[calc(100%-8px)] pointer-events-none select-none ${
            isReplaceMode
              ? 'border-primary/60 text-primary'
              : 'border-border text-foreground/70'
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
  const playheadInView = playheadX >= 100 && playheadX <= containerWidth + 100;
  const hasTimelineContent = tracks.length > 0;
  const showPlayhead =
    hasTimelineContent &&
    playheadInView &&
    (playbackState !== 'stopped' || playheadPosition > 0);

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
      {/* Ruler — hidden on empty state so the import view reads as one
          quiet surface, not a half-built editor. */}
      {hasTimelineContent && (
        <div
          className="h-8 bg-[#0a0d14] border-b border-border flex shrink-0 cursor-crosshair select-none relative"
          onClick={handleRulerClick}
        >
          <div className="w-[100px] shrink-0 border-r border-border bg-[#0a0d14] flex items-center px-2">
            <span
              className="text-[9px] uppercase tracking-[0.22em]"
              style={{ fontFamily: 'var(--app-font-ui)', color: 'hsl(var(--text-high))', fontWeight: 700 }}
            >
              Timeline
            </span>
          </div>
          <div className="flex-1 relative overflow-hidden">
            {rulerMarkers()}
          </div>
        </div>
      )}

      {/* Hidden file input — backs the click-to-import affordance on the
          empty drop zone. */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="audio/*,.wav,.mp3,.m4a,.aiff,.aif"
        multiple
        onChange={handleFilePick}
      />

      {/* Populated timeline has no atmospheric wash anymore — pure matte
          graphite. Hierarchy comes from typography, borders, and the
          waveform itself, not from ambient color. */}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden relative z-10">
        {tracks.length === 0 ? (
          <div className="absolute inset-0 overflow-hidden">

            <AtmosphericPanel />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-8 group cursor-pointer overflow-hidden transition-colors hover:bg-white/[0.012] focus:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(258_90%_70%)]"
              style={{
                background: 'transparent',
                border: '1px dashed hsl(228 12% 26% / 0.78)',
                boxShadow: 'inset 0 0 0 1px hsl(240 100% 70% / 0.025)',
              }}
              aria-label="Choose audio file to import"
            >
              {[
                'top-0 left-0 border-t border-l',
                'top-0 right-0 border-t border-r',
                'bottom-0 left-0 border-b border-l',
                'bottom-0 right-0 border-b border-r',
              ].map((pos) => (
                <span
                  key={pos}
                  aria-hidden
                  className={`absolute w-8 h-8 ${pos}`}
                  style={{ borderColor: 'hsl(var(--signal) / 0.72)' }}
                />
              ))}

              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-8 px-8">

                <div
                  className="w-[92px] h-[92px] border flex items-center justify-center"
                  style={{ borderColor: 'hsl(228 12% 18%)', borderRadius: 999 }}
                >
                  <svg width="38" height="38" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path
                      d="M12 17V5m0 0l-5 5m5-5l5 5M7 20h10"
                      stroke="hsl(268 90% 72%)"
                      strokeWidth="1.55"
                    />
                  </svg>
                </div>

                <div className="flex flex-col items-center gap-3">
                  <p
                    style={{
                      fontFamily: 'var(--app-font-ui)',
                      fontWeight: 700,
                      fontSize: '30px',
                      letterSpacing: '0.32em',
                      textTransform: 'uppercase',
                      color: 'hsl(var(--text-high))',
                    }}
                  >
                    Choose an audio file
                  </p>
                  <p
                    style={{
                      fontFamily: 'var(--app-font-ui)',
                      fontWeight: 700,
                      fontSize: '15px',
                      letterSpacing: '0.28em',
                      textTransform: 'uppercase',
                      color: 'hsl(var(--text-mid))',
                    }}
                  >
                    or drop one anywhere on this screen
                  </p>
                </div>

                <p
                  style={{
                    fontFamily: 'var(--app-font-ui)',
                    fontWeight: 700,
                    fontSize: '14px',
                    letterSpacing: '0.34em',
                    textTransform: 'uppercase',
                    color: 'hsl(var(--text-low))',
                  }}
                >
                  WAV · MP3 · M4A · AIFF
                </p>
              </div>
            </button>

          </div>
        ) : (
          <div className="relative">
            <div className="absolute top-0 bottom-0 pointer-events-none z-0" style={{ left: 100, right: 0 }}>
              <BeatGrid
                key={`beat-grid-${bpm}`}
                width={containerWidth - 100}
                height={
                  tracks.reduce((sum, t) => sum + getLaneHeight(t.id), 0)
                  + 32 /* section ribbon */
                }
                bpm={bpm}
                zoom={zoomLevel}
                scrollOffset={scrollPosition}
                visibleDuration={visibleDuration}
              />
            </div>

            {/* Section ribbon — heuristic intro/verse/chorus/etc. for the
                focused source track. Empty state stays visible when section
                data is unavailable. */}
            {(() => {
              const ribbonTrack = tracks.find(t => t.id === selectedTrackId)
                || tracks.find(t => t.isReference)
                || tracks[0];
              const ribbonTrackIndex = ribbonTrack ? tracks.findIndex(t => t.id === ribbonTrack.id) : -1;
              return ribbonTrack ? (
                <StructureRibbon
                  track={ribbonTrack}
                  trackIndex={Math.max(0, ribbonTrackIndex)}
                  trackCount={tracks.length}
                  pixelsPerSecond={pixelsPerSecond}
                  scrollOffset={scrollPosition}
                  containerWidth={containerWidth}
                />
              ) : null;
            })()}

            {tracks.map((track, idx) => {
              const laneHeight = getLaneHeight(track.id);
              return (
              <div
                key={track.id}
                data-testid={`track-row-${track.id}`}
                className="flex border-b border-border/50 relative z-10"
                style={{ height: laneHeight, backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.1)' }}
              >
                <div
                  className={`w-[100px] shrink-0 border-r border-border/80 px-2 py-1.5 flex flex-col justify-center cursor-pointer transition-colors select-none ${
                    sourcePlayTrackId === track.id
                      ? 'bg-primary/8 border-r-primary/40'
                      : 'bg-[#111111] hover:bg-white/5'
                  }`}
                  onClick={() => selectTrack(track.id)}
                  title="Click to focus this track for source playback"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] uppercase tracking-wide font-medium truncate text-foreground/80 leading-tight">{track.name}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tracks.length > 1 && (
                      <div className="flex items-center gap-0.5">
                        <span className="text-[8px] text-muted-foreground/70 tracking-[0.1em] uppercase">
                          SRC {String.fromCharCode(65 + idx)}
                        </span>
                      </div>
                    )}
                    {track.isReference && (
                      <div className="flex items-center gap-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        <span className="text-[8px] text-primary tracking-[0.1em] uppercase">MASTER</span>
                      </div>
                    )}
                    {track.isMuted && (
                      <div className="flex items-center gap-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/45" />
                        <span className="text-[8px] text-muted-foreground tracking-[0.1em] uppercase">MUTED</span>
                      </div>
                    )}
                    {sourcePlayTrackId === track.id && (
                      <div className="flex items-center gap-0.5">
                        <span className="text-[8px] text-primary/70 tracking-[0.1em] uppercase">▶ SRC</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 relative overflow-hidden">
                  <WaveformCanvas
                    waveformData={track.waveformData}
                    color={track.isReference ? 'hsl(258 65% 68% / 0.7)' : track.color}
                    pixelsPerSecond={pixelsPerSecond}
                    scrollOffset={scrollPosition}
                    duration={track.duration}
                    width={containerWidth - 100}
                    height={laneHeight}
                    className="absolute inset-0"
                  />
                  {renderSegmentOverlay(track.id, track.duration, track.color, track.name)}
                </div>

                {/* Lane resize handle — straddles the bottom border so the hit
                    target is generous without expanding the visual divider. */}
                <div
                  data-testid={`lane-resize-${track.id}`}
                  className="absolute left-0 right-0 z-30 group"
                  style={{ bottom: -3, height: 6, cursor: 'ns-resize' }}
                  onPointerDown={(e) => startLaneResize(e, track.id)}
                  title="Drag to resize lane height"
                >
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-transparent group-hover:bg-primary/60 transition-colors" />
                </div>
              </div>
              );
            })}

            {/* ArrangementLane removed from the UI — the primary timeline IS
                the arrangement. Section operations (mute, future reorder)
                happen directly on structure segments via StructureRibbon.
                Internal arrangementClips model is preserved for backward
                compatibility but no longer surfaced. */}

            {/* Snap guide — cyan vertical line shown while dragging a clip */}
            {snapGuideVisible && (
              <div
                className="absolute inset-y-0 pointer-events-none z-40"
                style={{
                  left: snapGuideX!,
                  width: 1,
                  background: 'hsl(var(--signal) / 0.65)',
                  boxShadow: '0 0 4px hsl(var(--signal) / 0.38)',
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Playhead — restrained. Crisp cyan core with a single short halo,
          no periwinkle outer ring. Reads as precise architecture. */}
      {showPlayhead && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none z-50"
          style={{
            left: playheadX,
            width: 1,
            backgroundColor: 'hsl(var(--signal))',
            opacity: 0.95,
            boxShadow: '0 0 3px hsl(var(--signal) / 0.45)',
          }}
        >
          <div
            className="absolute top-0"
            style={{
              width: 0,
              height: 0,
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '6px solid hsl(var(--signal))',
              left: -3.5,
              filter: 'drop-shadow(0 0 2px hsl(var(--signal) / 0.55))',
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
