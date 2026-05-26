import React from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from './ui/button';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { LevelMeter } from './LevelMeter';
import { BpmDragField } from './BpmDragField';

const FOOTER_LABEL_COLOR = 'hsl(268 64% 68%)';

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
    appliedBpm,
    bpmSource,
    setBpm,
    triggerPlay,
    isApplyingTempo,
    setApplyingTempo,
    zoomLevel,
    setZoom,
    isLooping,
    metronomeEnabled,
    setMetronomeEnabled,
  } = useProjectStore();

  // Show APPLY TEMPO when the visible grid BPM has drifted from what audio
  // is actually rendered at. Only meaningful during active playback — at
  // stopped/paused, the next play picks up the current bpm automatically.
  const tempoNeedsApply = playbackState === 'playing' && Math.abs(bpm - appliedBpm) > 0.001;

  const handleApplyTempo = () => {
    if (isApplyingTempo) return; // Guard against duplicate clicks
    setApplyingTempo(true);
    triggerPlay();
  };

  return (
    <div
      className="h-[92px] border-t border-border bg-card grid grid-cols-[minmax(320px,0.9fr)_auto_minmax(380px,1fr)] items-center gap-9 px-7 shrink-0 z-20 relative"
      style={{
        background: 'linear-gradient(180deg, hsl(240 7% 5%) 0%, hsl(240 7% 4%) 100%)',
      }}
    >
      <span aria-hidden className="absolute top-0 left-0 right-0 h-px pointer-events-none" style={{ background: 'hsl(220 18% 11%)' }} />

      <div className="flex items-end gap-20 min-w-0">
        <div className="min-w-[190px]">
          <span
            className="block uppercase leading-none mb-2"
            style={{
              color: FOOTER_LABEL_COLOR,
              fontFamily: 'var(--app-font-ui)',
              fontWeight: 700,
              fontSize: '15px',
              letterSpacing: '0.30em',
            }}
          >
            Bar · Beat
          </span>
          <span className="block font-mono text-[25px] leading-none tracking-[0.02em] text-foreground/90">
            {formatBars(playheadPosition, bpm)}
          </span>
        </div>
        <div className="min-w-[220px]">
          <span
            className="block uppercase leading-none mb-2"
            style={{
              color: FOOTER_LABEL_COLOR,
              fontFamily: 'var(--app-font-ui)',
              fontWeight: 700,
              fontSize: '15px',
              letterSpacing: '0.30em',
            }}
          >
            Time
          </span>
          <span className="block font-mono text-[25px] leading-none tracking-[0.02em] text-foreground/90">
            {formatTime(playheadPosition)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-5">
          <button
            className="w-12 h-12 flex items-center justify-center border border-border hover:bg-white/5 hover:border-foreground/20 transition-colors group"
            onClick={() => setPlayheadPosition(0)}
            title="Return to start"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-foreground/90 group-hover:text-foreground">
              <path d="M4 2v20h4V2H4zm6 10l10 10V2L10 12z" />
            </svg>
          </button>

          <button
            className="w-12 h-12 flex items-center justify-center border border-border hover:bg-white/5 hover:border-foreground/20 transition-colors group"
            onClick={() => setPlaybackState('stopped')}
            title="Stop (Enter)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-foreground/95 group-hover:text-foreground">
              <rect x="4" y="4" width="16" height="16" />
            </svg>
          </button>

          <button
            className="w-16 h-16 flex items-center justify-center bg-[#111111] border border-[var(--color-signal)]/55 hover:border-[var(--color-signal)] hover:bg-white/5 transition-all group relative disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-[#111111]"
            onClick={() => {
              if (isApplyingTempo) return;
              setPlaybackState(playbackState === 'playing' ? 'paused' : 'playing');
            }}
            disabled={isApplyingTempo}
            title={isApplyingTempo ? 'Applying tempo…' : 'Play / Pause (Space)'}
          >
            {playbackState === 'playing' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="hsl(var(--signal))" style={{ filter: 'drop-shadow(0 0 4px hsl(var(--signal) / 0.65))' }}>
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="21" height="21" viewBox="0 0 24 24" fill="hsl(var(--signal))" className="ml-1 transition-all" style={{ filter: 'drop-shadow(0 0 4px hsl(var(--signal) / 0.55))' }}>
                <path d="M4 2v20l17-10z" />
              </svg>
            )}
          </button>

          <button
            className={`w-12 h-12 flex items-center justify-center border transition-colors group ${
              metronomeEnabled
                ? 'border-[var(--color-signal)]/50 bg-[var(--color-signal)]/10'
                : 'border-border hover:bg-white/5 hover:border-primary/30'
            }`}
            onClick={() => setMetronomeEnabled(!metronomeEnabled)}
            title={metronomeEnabled ? 'Metronome on (grid BPM)' : 'Metronome off'}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              className={metronomeEnabled ? 'text-[var(--color-signal)]' : 'text-foreground/85 group-hover:text-foreground'}
              style={metronomeEnabled ? { filter: 'drop-shadow(0 0 3px hsl(var(--signal) / 0.45))' } : undefined}
            >
              <path d="M12 2v4" />
              <circle cx="12" cy="14" r="8" />
              <path d="M12 14l3-5" />
            </svg>
          </button>

          <button
            className="w-12 h-12 flex items-center justify-center border border-border hover:bg-white/5 hover:border-primary/40 transition-colors group"
            onClick={() => useProjectStore.setState({ isLooping: !isLooping })}
            title="Loop"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={isLooping ? { color: 'hsl(var(--signal))', filter: 'drop-shadow(0 0 3px hsl(var(--signal) / 0.50))' } : undefined}
              className={isLooping ? '' : 'text-foreground/85 group-hover:text-foreground'}>
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
      </div>

      <div className="flex items-center justify-end gap-9 min-w-0">
        <div className="flex items-center h-full">
          <LevelMeter />
        </div>

        <div
          className="flex flex-col justify-center min-w-[120px]"
          title="Project tempo — edit in the sidebar"
        >
          <span
            className="text-[15px] uppercase tracking-[0.30em] leading-none mb-2"
            style={{ fontFamily: 'var(--app-font-ui)', color: FOOTER_LABEL_COLOR, fontWeight: 700 }}
          >
            Tempo
          </span>
          <span
            className="text-[25px] font-mono leading-none"
            style={{ color: 'hsl(var(--text-high))', fontWeight: 600 }}
          >
            {bpm.toFixed(1)}
          </span>
        </div>

        {/* APPLY TEMPO — commits the grid BPM to the playing audio. Only
            shown while playback is active and the grid has drifted from
            what's actually rendered. Single click reschedules from the
            current playhead at the new tempo (one stretch, no menus). */}
        {tempoNeedsApply && (
          <button
            onClick={handleApplyTempo}
            disabled={isApplyingTempo}
            title={isApplyingTempo ? 'Applying…' : `Apply ${bpm} BPM to the playing audio`}
            className="h-12 px-4 border bg-transparent hover:bg-white/[0.04] text-[10px] uppercase tracking-[0.20em] transition-colors flex flex-col items-center justify-center leading-tight disabled:opacity-50 disabled:cursor-wait"
            style={{
              borderColor: 'hsl(var(--signal) / 0.45)',
              color: 'hsl(var(--signal))',
              fontFamily: 'var(--app-font-ui)',
              fontWeight: 700,
            }}
          >
            <span>APPLY</span>
            <span className="text-[7px] tracking-[0.16em] opacity-75">TEMPO</span>
          </button>
        )}

        <div className="flex items-center border border-border shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-none hover:bg-white/5 text-foreground/90 hover:text-foreground"
            onClick={() => setZoom(zoomLevel * 0.8)}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <span className="text-[12px] font-mono px-3 text-foreground/80 min-w-[6ch] text-center border-x border-border h-8 flex items-center" style={{ fontWeight: 500 }}>
            {Math.round(zoomLevel * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-none hover:bg-white/5 text-foreground/90 hover:text-foreground"
            onClick={() => setZoom(zoomLevel * 1.2)}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
