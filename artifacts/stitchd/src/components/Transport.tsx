import React, { useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from './ui/button';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { ExportModal } from './ExportModal';
import { ProjectModal } from './ProjectModal';
import { LevelMeter } from './LevelMeter';
import { BpmDragField } from './BpmDragField';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function formatBars(seconds: number, bpm: number): string {
  if (bpm <= 0) return '—:—:—';
  const beatsPerSecond = bpm / 60;
  const totalBeats = seconds * beatsPerSecond;
  const bars = Math.floor(totalBeats / 4) + 1;
  const beats = Math.floor(totalBeats % 4) + 1;
  const ticks = Math.floor((totalBeats % 1) * 100);
  return `${bars}:${beats}:${ticks.toString().padStart(2, '0')}`;
}

export function Transport() {
  const {
    playbackState,
    setPlaybackState,
    playheadPosition,
    setPlayheadPosition,
    bpm,
    bpmSource,
    setBpm,
    zoomLevel,
    setZoom,
    isLooping,
    metronomeEnabled,
    setMetronomeEnabled,
  } = useProjectStore();

  const [showExport, setShowExport] = useState(false);
  const [showProject, setShowProject] = useState(false);

  return (
    <div className="h-16 border-t border-border bg-card flex items-center px-4 justify-between shrink-0 z-20 relative">
      {/* Left */}
      <div className="flex items-center gap-4 w-1/4">
        <div className="text-[11px] font-bold text-muted-foreground tracking-[0.2em] uppercase">STITCHD</div>
        <div className="flex items-center gap-1">
          <button
            className="text-[9px] uppercase tracking-[0.12em] font-medium text-foreground/80 hover:text-primary px-2 py-1 transition-colors"
            onClick={() => setShowProject(true)}
          >
            PROJECT
          </button>
          <button
            className="text-[9px] uppercase tracking-[0.12em] font-medium text-foreground/80 hover:text-primary px-2 py-1 transition-colors"
            onClick={() => setShowExport(true)}
          >
            EXPORT
          </button>
        </div>
      </div>

      {/* Center: Displays + Controls */}
      <div className="flex items-center justify-center gap-6 w-2/4">
        <div className="flex gap-2 font-mono">
          {/* BARS display — labelled clearly so it is never mistaken for BPM */}
          <div className="bg-[#111111] border border-border px-3 py-1 flex flex-col items-center justify-center min-w-[130px] shadow-[inset_0_1px_4px_rgba(0,0,0,0.5)]">
            <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground font-medium -mb-0.5">
              BAR : BEAT : TICK
            </span>
            <span
              className="text-xl tracking-wider"
              style={{ color: 'hsl(176 82% 52%)', textShadow: '0 0 14px hsl(176 82% 46% / 0.65)' }}
            >
              {formatBars(playheadPosition, bpm)}
            </span>
          </div>

          {/* TIME display */}
          <div className="bg-[#111111] border border-border px-3 py-1 flex flex-col items-center justify-center min-w-[100px] shadow-[inset_0_1px_4px_rgba(0,0,0,0.5)]">
            <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground font-medium -mb-0.5">TIME</span>
            <span className="text-sm text-foreground/90 tracking-wider mt-1">{formatTime(playheadPosition)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="w-6 h-6 flex items-center justify-center hover:bg-white/5 transition-colors group"
            onClick={() => setPlayheadPosition(0)}
            title="Return to start"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground group-hover:text-foreground">
              <path d="M4 2v20h4V2H4zm6 10l10 10V2L10 12z" />
            </svg>
          </button>

          <button
            className="w-8 h-8 flex items-center justify-center border border-border hover:bg-white/5 hover:border-foreground/20 transition-colors group"
            onClick={() => setPlaybackState('stopped')}
            title="Stop (Enter)"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-foreground/70 group-hover:text-foreground">
              <rect x="4" y="4" width="16" height="16" />
            </svg>
          </button>

          <button
            className="w-10 h-10 flex items-center justify-center bg-[#111111] border border-border hover:border-primary/40 hover:bg-white/5 transition-all group relative"
            onClick={() => setPlaybackState(playbackState === 'playing' ? 'paused' : 'playing')}
            title="Play / Pause (Space)"
          >
            {playbackState === 'playing' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="hsl(176 82% 52%)" style={{ filter: 'drop-shadow(0 0 5px hsl(176 82% 46% / 0.85))' }}>
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="hsl(176 82% 52%)" className="ml-1 transition-all" style={{ filter: 'drop-shadow(0 0 6px hsl(176 82% 46% / 0.60))' }}>
                <path d="M4 2v20l17-10z" />
              </svg>
            )}
          </button>

          <button
            className={`w-8 h-6 flex items-center justify-center border transition-colors group ${
              metronomeEnabled
                ? 'border-primary/50 bg-primary/10'
                : 'border-border hover:bg-white/5 hover:border-primary/30'
            }`}
            onClick={() => setMetronomeEnabled(!metronomeEnabled)}
            title={metronomeEnabled ? 'Metronome on (grid BPM)' : 'Metronome off'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              className={metronomeEnabled ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}
              style={metronomeEnabled ? { filter: 'drop-shadow(0 0 4px hsl(176 82% 46% / 0.55))' } : undefined}
            >
              <path d="M12 2v4" />
              <circle cx="12" cy="14" r="8" />
              <path d="M12 14l3-5" />
            </svg>
          </button>

          <button
            className="w-6 h-6 flex items-center justify-center hover:bg-white/5 transition-colors ml-1 group"
            onClick={() => useProjectStore.setState({ isLooping: !isLooping })}
            title="Loop"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={isLooping ? { color: 'hsl(176 82% 52%)', filter: 'drop-shadow(0 0 4px hsl(176 82% 46% / 0.65))' } : undefined}
              className={isLooping ? '' : 'text-muted-foreground group-hover:text-foreground'}>
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Right: Level meter + BPM display + Zoom */}
      <div className="flex items-center justify-end gap-3 w-1/4">
        <div className="flex items-center h-full py-2">
          <LevelMeter />
        </div>

        <div className="w-px h-6 bg-border/60 shrink-0" />

        {/* BPM display — clearly labelled, editable inline, shows source state */}
        <div
          className={`flex flex-col items-center justify-center px-2 py-1 border min-w-[72px] h-9 ${
            bpmSource === 'auto'
              ? 'border-[var(--color-signal)]/30 bg-[var(--color-signal)]/5'
              : 'border-border bg-[#0E1117]'
          }`}
          title="Grid BPM — drag to adjust · double-click to type"
        >
          <span className="text-[7px] uppercase tracking-[0.12em] text-muted-foreground font-medium leading-none mb-0.5">
            {bpmSource === 'auto' ? '◉ GRID' : bpmSource === 'tap' ? '♪ TAP' : 'GRID'}
          </span>
          <BpmDragField
            value={bpm}
            onChange={(v) => setBpm(v, 'manual')}
            className="h-5"
            label=""
          />
        </div>

        <div className="flex items-center border border-border">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-none hover:bg-white/5 text-muted-foreground hover:text-foreground"
            onClick={() => setZoom(zoomLevel * 0.8)}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <span className="text-[10px] font-mono px-2 text-muted-foreground min-w-[5ch] text-center border-x border-border h-6 flex items-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-none hover:bg-white/5 text-muted-foreground hover:text-foreground"
            onClick={() => setZoom(zoomLevel * 1.2)}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <ExportModal open={showExport} onOpenChange={setShowExport} />
      <ProjectModal open={showProject} onOpenChange={setShowProject} />
    </div>
  );
}
