import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Progress } from './ui/progress';
import { useProjectStore } from '../store/useProjectStore';
import { renderArrangement } from '../hooks/useAudioEngine';
import { AlertCircle } from 'lucide-react';

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Shared text styles — NIGHTSHAPE UI is bold-only now, so every visible text
// element here pins its font + weight explicitly. Anything that wants a
// non-bold treatment uses the mono face (for technical values) instead of
// falling back to system-ui synthesized weights.
const STYLE_LABEL: React.CSSProperties = {
  fontFamily: 'var(--app-font-ui)',
  fontWeight: 700,
  color: 'hsl(var(--text-high))',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  fontSize: '10px',
};
const STYLE_VALUE: React.CSSProperties = {
  fontFamily: 'var(--app-font-mono)',
  color: 'hsl(var(--text-high))',
  fontSize: '12px',
};
const STYLE_HINT: React.CSSProperties = {
  fontFamily: 'var(--app-font-mono)',
  color: 'hsl(var(--text-mid))',
  fontSize: '11px',
};

export function ExportModal({ open, onOpenChange }: ExportModalProps) {
  const { projectName, tracks } = useProjectStore();
  const [filename, setFilename] = useState('');
  const [sampleRate, setSampleRate] = useState('44100');
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const effectiveName = filename.trim() || projectName || 'export';
  const canExport = tracks.some(t => !!t.audioBuffer);

  const handleExport = async () => {
    if (!canExport) {
      setError('Import an audio file first.');
      return;
    }

    setError(null);
    setIsExporting(true);
    setProgress(15);

    try {
      await new Promise(r => setTimeout(r, 80));
      setProgress(30);

      const blob = await renderArrangement(Number(sampleRate));
      setProgress(90);

      if (blob.size === 0) {
        throw new Error('Rendered output is empty.');
      }

      await new Promise(r => setTimeout(r, 100));
      setProgress(100);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${effectiveName}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setTimeout(() => {
        onOpenChange(false);
        setIsExporting(false);
        setProgress(0);
      }, 600);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Export failed: ${msg}`);
      setIsExporting(false);
      setProgress(0);
    }
  };

  const handleOpenChange = (o: boolean) => {
    if (isExporting) return;
    if (!o) {
      setError(null);
      setProgress(0);
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[440px] rounded-none p-6"
        style={{
          background: 'hsl(230 6% 6%)',
          border: '1px solid hsl(230 7% 18%)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.85)',
        }}
      >
        <DialogHeader>
          <DialogTitle
            className="text-[12px] uppercase tracking-[0.22em]"
            style={{ color: 'hsl(var(--text-high))', fontFamily: 'var(--app-font-ui)', fontWeight: 700 }}
          >
            Export
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Filename */}
          <div className="grid grid-cols-4 items-center gap-3">
            <label className="text-right" style={STYLE_LABEL}>Filename</label>
            <input
              value={filename}
              placeholder={effectiveName}
              onChange={(e) => setFilename(e.target.value)}
              disabled={isExporting}
              className="col-span-3 h-9 px-3 outline-none focus:border-[hsl(258_70%_55%)] transition-colors disabled:opacity-50"
              style={{
                ...STYLE_VALUE,
                background: 'hsl(230 6% 4%)',
                border: '1px solid hsl(230 7% 18%)',
              }}
            />
          </div>

          {/* Sample Rate */}
          <div className="grid grid-cols-4 items-center gap-3">
            <label className="text-right" style={STYLE_LABEL}>Sample Rate</label>
            <select
              value={sampleRate}
              onChange={(e) => setSampleRate(e.target.value)}
              disabled={isExporting}
              className="col-span-3 h-9 px-3 outline-none focus:border-[hsl(258_70%_55%)] transition-colors disabled:opacity-50 appearance-none cursor-pointer"
              style={{
                ...STYLE_VALUE,
                background: 'hsl(230 6% 4%)',
                border: '1px solid hsl(230 7% 18%)',
              }}
            >
              <option value="44100">44.1 kHz</option>
              <option value="48000">48 kHz</option>
            </select>
          </div>

          {/* Format */}
          <div className="grid grid-cols-4 items-center gap-3">
            <label className="text-right" style={STYLE_LABEL}>Format</label>
            <div className="col-span-3 h-9 flex items-center">
              <span style={STYLE_HINT}>WAV · 16-bit PCM · Stereo</span>
            </div>
          </div>

          {/* Source */}
          <div className="grid grid-cols-4 items-start gap-3">
            <label className="text-right pt-1" style={STYLE_LABEL}>Source</label>
            <div className="col-span-3 flex items-center">
              <span style={STYLE_HINT}>Current timeline · tempo-conformed · mutes honored</span>
            </div>
          </div>

          {isExporting && (
            <div className="space-y-2 mt-2">
              <Progress value={progress} className="w-full h-1" />
              <p
                className="text-center"
                style={{
                  fontFamily: 'var(--app-font-mono)',
                  color: 'hsl(var(--text-mid))',
                  fontSize: '11px',
                }}
              >
                {progress < 30 ? 'Preparing…' : progress < 90 ? 'Rendering audio…' : 'Encoding WAV…'}
              </p>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-2 px-3 py-2 border text-[11px]"
              style={{
                background: 'hsl(286 24% 9%)',
                borderColor: 'hsl(286 48% 42%)',
                color: 'hsl(224 22% 76%)',
                fontFamily: 'var(--app-font-ui)',
                fontWeight: 700,
              }}
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <button
            onClick={() => handleOpenChange(false)}
            disabled={isExporting}
            className="h-9 px-4 border bg-transparent hover:bg-white/[0.04] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              fontFamily: 'var(--app-font-ui)',
              fontWeight: 700,
              fontSize: '10px',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'hsl(var(--text-high))',
              borderColor: 'hsl(230 7% 18%)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || !canExport}
            data-testid="button-export-wav"
            className="h-9 px-4 border bg-transparent hover:bg-white/[0.04] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              fontFamily: 'var(--app-font-ui)',
              fontWeight: 700,
              fontSize: '10px',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'hsl(258 48% 74%)',
              borderColor: 'hsl(258 70% 55%)',
            }}
          >
            {isExporting ? 'Exporting…' : 'Export WAV'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
