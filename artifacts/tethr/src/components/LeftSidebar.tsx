import React, { useRef, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Volume2, VolumeX, Trash2, Activity, Scissors, Hand, MousePointer2, RotateCcw, Magnet } from 'lucide-react';
import { SegmentMode, BpmSource, SnapResolution } from '../types/audio';
import { BpmDragField } from './BpmDragField';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const SIDE_LABEL_COLOR = 'hsl(268 64% 68%)';

function formatConfidence(c: number): string {
  if (c >= 0.7) return 'high';
  if (c >= 0.35) return 'med';
  return 'low';
}

export function LeftSidebar() {
  const {
    tracks,
    importTrack,
    removeTrack,
    setReferenceTrack,
    updateTrack,
    bpm,
    appliedBpm,
    bpmSource,
    setBpm,
    playbackState,
    triggerPlay,
    isApplyingTempo,
    setApplyingTempo,
    segmentMode,
    setSegmentMode,
    toolMode,
    setToolMode,
    snapEnabled,
    snapResolution,
    setSnapEnabled,
    setSnapResolution,
  } = useProjectStore();

  // Mirrors Transport's tempoNeedsApply — surface the button next to both
  // BPM editors so the user can commit a tempo change from wherever they're
  // looking. Hidden when stopped/paused (next play picks up bpm automatically).
  const tempoNeedsApply = playbackState === 'playing' && Math.abs(bpm - appliedBpm) > 0.001;

  const handleApplyTempo = () => {
    if (isApplyingTempo) return; // Guard against duplicate clicks
    setApplyingTempo(true);
    triggerPlay();
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tapTimes, setTapTimes] = useState<number[]>([]);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach(file => importTrack(file));
      e.target.value = '';
    }
  };

  const handleTapTempo = () => {
    const now = performance.now();
    const newTimes = [...tapTimes, now].slice(-6);
    setTapTimes(newTimes);

    if (newTimes.length > 1) {
      const intervals: number[] = [];
      for (let i = 1; i < newTimes.length; i++) {
        intervals.push(newTimes[i] - newTimes[i - 1]);
      }
      const avg = intervals.reduce((a, b) => a + b) / intervals.length;
      const newBpm = Math.round(60000 / avg);
      setBpm(Math.min(300, Math.max(30, newBpm)), 'tap');
    }
  };

  const handleBpmChange = (v: number) => setBpm(v, 'manual');

  const handleRevertToAuto = () => {
    const refTrack = tracks.find(t => t.isReference);
    if (refTrack?.estimatedBpm) {
      setBpm(refTrack.estimatedBpm, 'auto');
    }
  };

  const refTrack = tracks.find(t => t.isReference);
  // Show "Revert to detected" whenever the current project tempo actually
  // differs from the reference track's detected value — independent of
  // bpmSource ('manual' | 'tap' | 'auto'). Previously this was gated on
  // bpmSource === 'manual', which hid the revert affordance after a Tap
  // even though the tempo still didn't match the detected BPM.
  const canRevertToAuto = refTrack?.estimatedBpm != null
    && Math.abs(refTrack.estimatedBpm - bpm) > 0.01;
  const hasLoadedAudio = tracks.some(track => !!track.audioBuffer);

  const SNAP_LABELS: Record<SnapResolution, string> = {
    'bar': 'Bar',
    'beat': 'Beat',
    '1/2-beat': '1/2',
    '1/4-beat': '1/4',
  };

  return (
    <div
      className="w-[360px] border-r border-border bg-sidebar text-sidebar-foreground flex flex-col h-full shrink-0"
      style={{
        background:
          'linear-gradient(180deg, hsl(240 7% 5%) 0%, hsl(240 7% 4%) 100%)',
      }}
    >
      <div className="px-6 pt-7 pb-6 border-b border-border/70 space-y-7">
        <div className="space-y-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full bg-transparent uppercase rounded-none h-[96px] text-left px-6 transition-colors hover:bg-white/[0.025]"
            style={{
              border: '2px solid hsl(268 80% 60%)',
              color: 'hsl(var(--signal))',
              fontFamily: 'var(--app-font-ui)',
              fontWeight: 700,
              letterSpacing: '0.25em',
              fontSize: '24px',
              boxShadow: 'inset 0 0 0 1px hsl(var(--signal) / 0.10)',
            }}
          >
            Import Audio
          </button>

          <div className="grid grid-cols-[88px_1fr] items-baseline gap-4 px-1" aria-live="polite">
            <span
              className="uppercase"
              style={{
                color: SIDE_LABEL_COLOR,
                fontFamily: 'var(--app-font-ui)',
                fontWeight: 700,
                fontSize: '10px',
                letterSpacing: '0.26em',
              }}
            >
              Status
            </span>
            <span
              className="uppercase"
              style={{
                color: hasLoadedAudio ? 'hsl(var(--signal))' : 'hsl(var(--text-mid))',
                fontFamily: 'var(--app-font-ui)',
                fontWeight: 700,
                fontSize: '12px',
                letterSpacing: '0.24em',
              }}
            >
              {hasLoadedAudio ? 'Loaded' : 'Empty'}
            </span>
          </div>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImport}
          className="hidden"
          accept="audio/*,.wav,.mp3,.m4a,.aiff,.aif"
          multiple
        />

        {/* Project tempo — the single editable tempo field. The Transport
            shows a read-only mirror of this value. */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label
              className="text-[13px] uppercase tracking-[0.32em]"
              style={{ fontFamily: 'var(--app-font-ui)', color: SIDE_LABEL_COLOR, fontWeight: 700 }}
            >
              Tempo
            </label>
            <span
              className="text-[11px] uppercase tracking-[0.28em] px-1"
              style={{
                fontFamily: 'var(--app-font-ui)',
                fontWeight: 700,
                color: bpmSource === 'auto'
                  ? 'hsl(var(--signal))'
                  : bpmSource === 'tap'
                  ? 'hsl(258 50% 70%)'
                  : 'hsl(258 38% 62%)',
              }}
            >
              {bpmSource === 'auto' ? '◉ Auto' : bpmSource === 'tap' ? '♪ Tap' : '○ Manual'}
            </span>
          </div>

          <div className="grid grid-cols-[1fr_132px] gap-4">
            <div className="relative">
              <div className={`bg-[#0E1117] border h-[74px] ${
                bpmSource === 'auto' ? 'border-primary/45' : 'border-border'
              }`}>
                <BpmDragField value={bpm} onChange={handleBpmChange} className="h-[74px]" />
              </div>
            </div>

            <button
              onClick={handleTapTempo}
              className="h-[74px] bg-transparent border uppercase rounded-none transition-colors hover:bg-white/[0.04]"
              style={{
                borderColor: 'hsl(230 7% 18%)',
                color: 'hsl(var(--text-high))',
                fontFamily: 'var(--app-font-ui)',
                fontWeight: 700,
                letterSpacing: '0.24em',
                fontSize: '15px',
              }}
            >
              Tap
            </button>
          </div>

          {/* APPLY TEMPO — sidebar variant. Same action as the Transport
              button (triggerPlay() reschedules at the new BPM from the
              current playhead). Full-width so it's unmissable while the
              user is editing the project TEMPO here. */}
          {tempoNeedsApply && (
            <button
              onClick={handleApplyTempo}
              disabled={isApplyingTempo}
              title={isApplyingTempo ? 'Applying…' : `Apply ${bpm} BPM to the playing audio`}
              className="w-full h-8 border bg-transparent hover:bg-white/[0.04] text-[10px] uppercase tracking-[0.20em] transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-wait"
              style={{
                borderColor: 'hsl(268 70% 55%)',
                color: 'hsl(258 48% 74%)',
                fontFamily: 'var(--app-font-ui)',
                fontWeight: 700,
              }}
            >
              <span>Apply Tempo</span>
              <span className="font-mono opacity-70">→ {Math.round(bpm)}</span>
            </button>
          )}

          {canRevertToAuto && (
            <button
              onClick={handleRevertToAuto}
              className="flex items-center gap-1 text-[9px] uppercase tracking-[0.16em] transition-colors hover:opacity-100"
              style={{
                color: 'hsl(258 48% 68%)',
                fontFamily: 'var(--app-font-ui)',
                fontWeight: 700,
                opacity: 0.85,
              }}
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Revert to detected {refTrack!.estimatedBpm} BPM
            </button>
          )}
        </div>

        <div className="space-y-3">
          <label
            className="text-[13px] uppercase tracking-[0.32em] block"
            style={{ fontFamily: 'var(--app-font-ui)', color: SIDE_LABEL_COLOR, fontWeight: 700 }}
          >
            Segment Mode
          </label>
          <Select value={segmentMode.toString()} onValueChange={(v) => setSegmentMode(Number(v) as SegmentMode)}>
            <SelectTrigger
              className="h-[54px] bg-transparent rounded-none uppercase focus:ring-0 transition-colors hover:bg-white/[0.04]"
              style={{
                fontFamily: 'var(--app-font-ui)',
                fontWeight: 700,
                fontSize: '14px',
                letterSpacing: '0.24em',
                borderColor: 'hsl(230 7% 18%)',
                color: 'hsl(var(--text-high))',
              }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-border">
              <SelectItem value="4" className="text-xs uppercase tracking-[0.08em] rounded-none">4 Bars</SelectItem>
              <SelectItem value="8" className="text-xs uppercase tracking-[0.08em] rounded-none">8 Bars</SelectItem>
              <SelectItem value="16" className="text-xs uppercase tracking-[0.08em] rounded-none">16 Bars</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tool mode */}
      <div className="px-6 pt-5 pb-5 border-b border-border/70 bg-black/10">
        <div className="flex gap-4 mb-4">
          {([
            { mode: 'select' as const, Icon: MousePointer2, title: 'Select (V)' },
            { mode: 'slip' as const, Icon: Hand, title: 'Slip (S)' },
            { mode: 'split' as const, Icon: Scissors, title: 'Split (X)' },
            { mode: 'warp' as const, Icon: Activity, title: 'Warp (W)' },
          ]).map(({ mode, Icon, title }) => {
            const active = toolMode === mode;
            return (
              <button
                key={mode}
                onClick={() => setToolMode(mode)}
                title={title}
                className="w-[50px] h-[50px] rounded-none flex items-center justify-center transition-colors hover:bg-white/[0.04]"
                style={active ? {
                  border: '1px solid hsl(268 80% 60%)',
                  color: 'hsl(258 55% 74%)',
                } : {
                  border: '1px solid transparent',
                  color: 'hsl(var(--text-mid))',
                }}
              >
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
        </div>

        {/* Snap controls */}
        <div className="grid grid-cols-[132px_1fr] gap-3">
          <button
            onClick={() => setSnapEnabled(!snapEnabled)}
            title={snapEnabled ? 'Snap ON — click to disable (Shift inverts during drag)' : 'Snap OFF — click to enable'}
            className="flex items-center justify-center gap-2 h-11 px-3 border uppercase transition-colors shrink-0 hover:bg-white/[0.04]"
            style={{
              fontFamily: 'var(--app-font-ui)',
              fontWeight: 700,
              fontSize: '12px',
              letterSpacing: '0.22em',
              borderColor: snapEnabled ? 'hsl(268 80% 60%)' : 'hsl(230 7% 18%)',
              color: snapEnabled ? 'hsl(258 55% 74%)' : 'hsl(var(--text-mid))',
            }}
          >
            <Magnet className="w-3 h-3" />
            Snap
          </button>
          <Select
            value={snapResolution}
            onValueChange={(v) => setSnapResolution(v as SnapResolution)}
          >
            <SelectTrigger
              className="h-11 flex-1 bg-transparent rounded-none uppercase focus:ring-0 transition-colors hover:bg-white/[0.04]"
              style={{
                fontFamily: 'var(--app-font-ui)',
                fontWeight: 700,
                fontSize: '12px',
                letterSpacing: '0.22em',
                borderColor: snapEnabled ? 'hsl(268 60% 45%)' : 'hsl(230 7% 18%)',
                color: snapEnabled ? 'hsl(258 55% 74%)' : 'hsl(var(--text-mid))',
              }}
            >
              <SelectValue>{SNAP_LABELS[snapResolution]}</SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-none border-border">
              <SelectItem value="bar" className="text-xs uppercase tracking-[0.08em] rounded-none">Bar</SelectItem>
              <SelectItem value="beat" className="text-xs uppercase tracking-[0.08em] rounded-none">Beat</SelectItem>
              <SelectItem value="1/2-beat" className="text-xs uppercase tracking-[0.08em] rounded-none">½ Beat</SelectItem>
              <SelectItem value="1/4-beat" className="text-xs uppercase tracking-[0.08em] rounded-none">¼ Beat</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p
          className="text-[11px] mt-4 uppercase tracking-[0.28em] leading-tight"
          style={{
            fontFamily: 'var(--app-font-ui)',
            fontWeight: 700,
            color: 'hsl(258 38% 62%)',
          }}
        >
          Shift inverts snap during drag
        </p>
      </div>

      {/* Track list */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-4">
        {tracks.map(track => (
          <div key={track.id} className="group flex flex-col py-2 px-3 border-b border-border hover:bg-white/5 transition-colors relative">
            <div className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ backgroundColor: track.color }} />

            <div className="flex items-center justify-between mb-1">
              <div className="flex-1 min-w-0 pr-2">
                <input
                  value={track.name}
                  onChange={(e) => updateTrack(track.id, { name: e.target.value })}
                  className="w-full bg-transparent border-transparent hover:border-border focus:border-primary text-xs text-foreground/80 outline-none truncate uppercase tracking-[0.08em]"
                />
              </div>
              <div className="text-[9px] font-mono text-muted-foreground shrink-0 flex items-center gap-1.5">
                <span>{track.duration > 0 ? `${track.duration.toFixed(1)}s` : '—'}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive rounded-none"
                  onClick={() => removeTrack(track.id)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {/* Per-track detected BPM (analysis only) — USE copies to grid BPM */}
            <div className="flex items-center gap-1.5 mb-1.5">
              {track.estimatedBpm !== null ? (
                <>
                  <div className={`flex items-center gap-1 px-1.5 py-0.5 border text-[8px] font-mono leading-none ${
                    track.bpmConfidence >= 0.7
                      ? 'border-primary/40 text-primary bg-primary/5'
                      : track.bpmConfidence >= 0.35
                      ? 'border-border text-foreground/70'
                      : 'border-border/60 text-muted-foreground/75 bg-white/[0.025]'
                  }`}>
                    <span>Detected: {track.estimatedBpm}</span>
                    {track.bpmConfidence < 0.35 && (
                      <span className="text-muted-foreground ml-0.5" title={`Low confidence (${Math.round(track.bpmConfidence * 100)}%) — consider manual override`}>?</span>
                    )}
                    {track.bpmConfidence >= 0.35 && (
                      <span className="text-[7px] uppercase tracking-[0.06em] opacity-50 ml-0.5">
                        {formatConfidence(track.bpmConfidence)}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setBpm(track.estimatedBpm!, 'auto')}
                    className="px-1.5 py-0.5 border border-primary/30 text-[8px] uppercase tracking-[0.08em] text-primary/60 hover:text-primary hover:border-primary hover:bg-primary/5 transition-colors font-medium leading-none"
                    title={`Use detected ${track.estimatedBpm} BPM as project tempo`}
                  >
                    → TEMPO
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-1 px-1.5 py-0.5 border border-border/40 text-[8px] font-mono text-muted-foreground/40 italic">
                  BPM unknown
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className={`h-5 text-[9px] uppercase tracking-[0.08em] px-2 rounded-none ${track.isReference ? 'border border-primary text-primary' : 'border border-border text-muted-foreground hover:border-primary/50'}`}
                onClick={() => setReferenceTrack(track.id)}
                title="Default track for source playback when no arrangement clips exist"
              >
                {track.isReference ? 'MASTER' : 'SET MASTER'}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={`h-5 w-6 rounded-none border ${track.isMuted ? 'border-muted-foreground/45 text-muted-foreground' : 'border-border text-muted-foreground hover:border-primary/50'}`}
                onClick={() => updateTrack(track.id, { isMuted: !track.isMuted })}
              >
                {track.isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              </Button>
              <div className="flex-1 px-1">
                <Slider
                  value={[track.volume]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={([v]) => {
                    if (v !== undefined) updateTrack(track.id, { volume: v });
                  }}
                  className="flex-1"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
