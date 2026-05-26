import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Label } from './ui/label';
import { Slider } from './ui/slider';
import { Clip } from '../types/audio';

interface CrossfadeEditorProps {
  clip: Clip;
  outputDuration: number;   // actual playback seconds (sourceDuration / stretchRatio)
  secondsPerBar?: number;   // optional — enables the "1 BAR" quick preset
  onChange: (updates: Partial<Clip>) => void;
}

const MS_PRESETS = [
  { label: '0',   value: 0 },
  { label: '10',  value: 0.010 },
  { label: '50',  value: 0.050 },
  { label: '100', value: 0.100 },
  { label: '200', value: 0.200 },
  { label: '500', value: 0.500 },
];

interface PresetRowProps {
  current: number;
  max: number;
  secondsPerBar?: number;
  onSet: (v: number) => void;
}

function PresetRow({ current, max, secondsPerBar, onSet }: PresetRowProps) {
  return (
    <div className="flex gap-px">
      {MS_PRESETS.map(({ label, value }) => {
        const clamped = Math.min(value, max);
        const active  = Math.abs(current - clamped) < 0.005;
        return (
          <button
            key={label}
            onClick={() => onSet(clamped)}
            title={value === 0 ? '0 ms' : `${Math.round(value * 1000)} ms`}
            className={`flex-1 h-5 text-[8px] uppercase tracking-[0.06em] font-medium transition-colors border ${
              active
                ? 'border-primary/60 text-primary bg-primary/10'
                : 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        );
      })}

      {/* 1-bar preset — only shown when BPM is known */}
      {secondsPerBar != null && secondsPerBar > 0 && (() => {
        const barClamped = Math.min(secondsPerBar, max);
        const barActive  = Math.abs(current - barClamped) < 0.005;
        return (
          <button
            onClick={() => onSet(barClamped)}
            title={`1 bar at current BPM (${secondsPerBar.toFixed(2)}s)`}
            className={`flex-1 h-5 text-[8px] uppercase tracking-[0.06em] font-medium transition-colors border ${
              barActive
                ? 'border-primary/60 text-primary bg-primary/10'
                : 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-white/5'
            }`}
          >
            1B
          </button>
        );
      })()}

      <span className="text-[7px] text-muted-foreground/40 self-center ml-1 shrink-0">ms</span>
    </div>
  );
}

export function CrossfadeEditor({ clip, outputDuration, secondsPerBar, onChange }: CrossfadeEditorProps) {
  // Cap slider max to actual output duration so fades never exceed the clip's playback time
  const maxFade = Math.max(0, Math.min(5, outputDuration));
  const totalFades = (clip.fadeIn || 0) + (clip.fadeOut || 0);
  const fadesTooLong = outputDuration > 0 && totalFades > outputDuration;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">FADE CURVE</Label>
        <Select
          value={clip.fadeCurve}
          onValueChange={(v: any) => onChange({ fadeCurve: v })}
        >
          <SelectTrigger className="h-8 rounded-none border-border bg-transparent hover:border-primary/50 text-xs uppercase tracking-[0.08em] focus:ring-0 focus:border-primary">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-none border-border">
            <SelectItem value="linear"       className="text-xs uppercase tracking-[0.08em] rounded-none">Linear</SelectItem>
            <SelectItem value="equal-power"  className="text-xs uppercase tracking-[0.08em] rounded-none">Equal Power</SelectItem>
            <SelectItem value="s-curve"      className="text-xs uppercase tracking-[0.08em] rounded-none">S-Curve</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between items-baseline">
          <Label className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">FADE IN</Label>
          <span className="text-[9px] font-mono text-primary">{(clip.fadeIn * 1000).toFixed(0)} ms</span>
        </div>
        <PresetRow
          current={clip.fadeIn}
          max={maxFade}
          secondsPerBar={secondsPerBar}
          onSet={(v) => onChange({ fadeIn: v })}
        />
        <Slider
          value={[clip.fadeIn]}
          max={maxFade}
          step={0.005}
          onValueChange={([v]) => onChange({ fadeIn: v })}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between items-baseline">
          <Label className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">FADE OUT</Label>
          <span className="text-[9px] font-mono text-primary">{(clip.fadeOut * 1000).toFixed(0)} ms</span>
        </div>
        <PresetRow
          current={clip.fadeOut}
          max={maxFade}
          secondsPerBar={secondsPerBar}
          onSet={(v) => onChange({ fadeOut: v })}
        />
        <Slider
          value={[clip.fadeOut]}
          max={maxFade}
          step={0.005}
          onValueChange={([v]) => onChange({ fadeOut: v })}
        />
      </div>

      {fadesTooLong && (
        <p className="text-[8px] text-primary/80 uppercase tracking-[0.06em] leading-snug">
          Fades overlap — scaled to fit {outputDuration.toFixed(2)}s clip
        </p>
      )}
    </div>
  );
}
