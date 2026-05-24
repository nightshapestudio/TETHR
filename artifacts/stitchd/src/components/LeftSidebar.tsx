import React, { useRef, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Volume2, VolumeX, Trash2, Activity, Scissors, Hand, MousePointer2, RotateCcw, Magnet } from 'lucide-react';
import { SegmentMode, BpmSource, SnapResolution } from '../types/audio';
import { BpmDragField } from './BpmDragField';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

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
    bpmSource,
    setBpm,
    segmentMode,
    setSegmentMode,
    toolMode,
    setToolMode,
    snapEnabled,
    snapResolution,
    setSnapEnabled,
    setSnapResolution,
  } = useProjectStore();

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
  const canRevertToAuto = bpmSource === 'manual' && refTrack?.estimatedBpm != null;

  const SNAP_LABELS: Record<SnapResolution, string> = {
    'bar': 'Bar',
    'beat': 'Beat',
    '1/2-beat': '1/2',
    '1/4-beat': '1/4',
  };

  return (
    <div className="w-64 border-r border-border bg-sidebar text-sidebar-foreground flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-border space-y-4">
        <Button
          onClick={() => fileInputRef.current?.click()}
          className="w-full bg-transparent border border-border text-foreground font-semibold uppercase tracking-[0.12em] rounded-none py-4 text-xs transition-all"
          style={{
            borderLeft: '2px solid hsl(176 82% 48%)',
            boxShadow: 'inset 0 0 0 0 transparent',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = 'hsl(176 82% 48% / 0.6)';
            (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px hsl(176 82% 46% / 0.10)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = '';
            (e.currentTarget as HTMLElement).style.boxShadow = '';
          }}
        >
          IMPORT AUDIO
        </Button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImport}
          className="hidden"
          accept="audio/*,.wav,.mp3,.m4a,.aiff,.aif"
          multiple
        />

        {/* Project BPM */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground font-medium">
              GRID BPM
            </label>
            <span className={`text-[8px] uppercase tracking-[0.1em] font-medium px-1 ${
              bpmSource === 'auto'
                ? 'text-primary/80'
                : bpmSource === 'tap'
                ? 'text-foreground/60'
                : 'text-muted-foreground/50'
            }`}>
              {bpmSource === 'auto' ? '◉ AUTO' : bpmSource === 'tap' ? '♪ TAP' : '✎ MANUAL'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <div className={`bg-[#0E1117] border h-9 ${
                bpmSource === 'auto' ? 'border-[var(--color-signal)]/40' : 'border-border'
              }`}>
                <BpmDragField value={bpm} onChange={handleBpmChange} className="h-9" />
              </div>
            </div>

            <Button
              variant="outline"
              onClick={handleTapTempo}
              className="h-9 bg-transparent border-border hover:bg-white/5 hover:border-primary/50 uppercase tracking-[0.08em] rounded-none text-xs text-foreground focus:border-primary focus:text-primary active:border-primary active:text-primary"
            >
              TAP
            </Button>
          </div>

          {canRevertToAuto && (
            <button
              onClick={handleRevertToAuto}
              className="flex items-center gap-1 text-[8px] uppercase tracking-[0.08em] text-primary/60 hover:text-primary transition-colors"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Revert to detected {refTrack!.estimatedBpm} BPM
            </button>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground font-medium">SEGMENT MODE</label>
          <Select value={segmentMode.toString()} onValueChange={(v) => setSegmentMode(Number(v) as SegmentMode)}>
            <SelectTrigger className="h-8 bg-transparent border-border rounded-none uppercase tracking-[0.08em] text-xs hover:border-primary/50 focus:ring-0 focus:border-primary">
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
      <div className="px-2 pt-2 pb-1 border-b border-border bg-black/10">
        <div className="flex justify-center gap-1 mb-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setToolMode('select')}
            className={`w-7 h-7 rounded-none ${toolMode === 'select' ? 'text-primary shadow-[0_2px_8px_hsl(var(--primary)/0.4)]' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
            title="Select (V)"
          >
            <MousePointer2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setToolMode('slip')}
            className={`w-7 h-7 rounded-none ${toolMode === 'slip' ? 'text-primary shadow-[0_2px_8px_hsl(var(--primary)/0.4)]' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
            title="Slip (S)"
          >
            <Hand className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setToolMode('split')}
            className={`w-7 h-7 rounded-none ${toolMode === 'split' ? 'text-primary shadow-[0_2px_8px_hsl(var(--primary)/0.4)]' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
            title="Split (X)"
          >
            <Scissors className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setToolMode('warp')}
            className={`w-7 h-7 rounded-none ${toolMode === 'warp' ? 'text-primary shadow-[0_2px_8px_hsl(var(--primary)/0.4)]' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
            title="Warp (W)"
          >
            <Activity className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Snap controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSnapEnabled(!snapEnabled)}
            title={snapEnabled ? 'Snap ON — click to disable (Shift inverts during drag)' : 'Snap OFF — click to enable'}
            className={`flex items-center gap-1 h-6 px-2 border text-[9px] uppercase tracking-[0.1em] font-medium transition-colors shrink-0 ${
              snapEnabled
                ? 'border-primary/60 text-primary bg-primary/8 shadow-[0_0_6px_hsl(var(--primary)/0.2)]'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
            }`}
          >
            <Magnet className="w-3 h-3" />
            SNAP
          </button>
          <Select
            value={snapResolution}
            onValueChange={(v) => setSnapResolution(v as SnapResolution)}
          >
            <SelectTrigger
              className={`h-6 flex-1 bg-transparent rounded-none text-[9px] uppercase tracking-[0.08em] focus:ring-0 transition-colors ${
                snapEnabled
                  ? 'border-primary/30 text-primary hover:border-primary/60'
                  : 'border-border text-muted-foreground hover:border-primary/30'
              }`}
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
        <p className="text-[7px] text-muted-foreground/30 mt-1 tracking-wide">Shift inverts snap during drag</p>
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
                      : 'border-amber-500/40 text-amber-400/80'
                  }`}>
                    <span>Detected: {track.estimatedBpm}</span>
                    {track.bpmConfidence < 0.35 && (
                      <span className="text-amber-400 ml-0.5" title={`Low confidence (${Math.round(track.bpmConfidence * 100)}%) — consider manual override`}>?</span>
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
                    title={`Apply detected ${track.estimatedBpm} BPM to grid (auto)`}
                  >
                    → GRID
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
                className={`h-5 w-6 rounded-none border ${track.isMuted ? 'border-destructive text-destructive' : 'border-border text-muted-foreground hover:border-primary/50'}`}
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
