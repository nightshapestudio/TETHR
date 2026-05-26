import React, { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { useProjectStore } from '../store/useProjectStore';
import { AlertCircle, Check } from 'lucide-react';

interface ProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'loading' }
  | { kind: 'success'; msg: string }
  | { kind: 'error'; msg: string };

export function ProjectModal({ open, onOpenChange }: ProjectModalProps) {
  const { saveProject, loadProject } = useProjectStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const busy = status.kind === 'saving' || status.kind === 'loading';

  const handleSave = async () => {
    if (busy) return;
    setStatus({ kind: 'saving' });
    try {
      await saveProject();
      setStatus({ kind: 'success', msg: 'Project saved with bundled audio.' });
      setTimeout(() => {
        setStatus({ kind: 'idle' });
        onOpenChange(false);
      }, 900);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', msg: `Save failed: ${msg}` });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (busy) return;

    setStatus({ kind: 'loading' });
    try {
      const text = await file.text();
      await loadProject(text);
      setStatus({ kind: 'success', msg: 'Project restored.' });
      setTimeout(() => {
        setStatus({ kind: 'idle' });
        onOpenChange(false);
      }, 900);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', msg: `Load failed: ${msg}` });
    } finally {
      // Reset input so the same file can be picked again later
      e.target.value = '';
    }
  };

  const handleOpenChange = (o: boolean) => {
    if (busy) return; // don't let the user dismiss mid-operation
    if (!o) setStatus({ kind: 'idle' });
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[420px] rounded-none p-6"
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
            Project
          </DialogTitle>
          <DialogDescription
            className="text-[11px] tracking-wide"
            style={{ color: 'hsl(var(--text-mid))' }}
          >
            Save or load a TETHR session. Audio is bundled — projects open the same way they were saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <button
            disabled={busy}
            className="w-full flex items-center justify-between px-4 py-3 border bg-transparent transition-colors group text-left disabled:opacity-50 disabled:cursor-wait"
            style={{
              borderColor: 'hsl(230 7% 18%)',
              background: busy && status.kind === 'saving' ? 'hsl(230 7% 10%)' : 'transparent',
            }}
            onMouseEnter={(e) => { if (!busy) (e.currentTarget as HTMLElement).style.borderColor = 'hsl(258 70% 55%)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'hsl(230 7% 18%)'; }}
            onClick={handleSave}
          >
            <div>
              <div
                className="text-[12px] uppercase tracking-[0.14em]"
                style={{ color: 'hsl(var(--text-high))', fontFamily: 'var(--app-font-ui)', fontWeight: 700 }}
              >
                {status.kind === 'saving' ? 'Saving…' : 'Save Project'}
              </div>
              <div
                className="text-[10px] mt-0.5 font-mono"
                style={{ color: 'hsl(var(--text-mid))' }}
              >
                Download .tethr file · audio bundled
              </div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-foreground shrink-0">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
          </button>

          <button
            disabled={busy}
            className="w-full flex items-center justify-between px-4 py-3 border bg-transparent transition-colors group text-left disabled:opacity-50 disabled:cursor-wait"
            style={{
              borderColor: 'hsl(230 7% 18%)',
              background: busy && status.kind === 'loading' ? 'hsl(230 7% 10%)' : 'transparent',
            }}
            onMouseEnter={(e) => { if (!busy) (e.currentTarget as HTMLElement).style.borderColor = 'hsl(258 70% 55%)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'hsl(230 7% 18%)'; }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div>
              <div
                className="text-[12px] uppercase tracking-[0.14em]"
                style={{ color: 'hsl(var(--text-high))', fontFamily: 'var(--app-font-ui)', fontWeight: 700 }}
              >
                {status.kind === 'loading' ? 'Restoring…' : 'Load Project'}
              </div>
              <div
                className="text-[10px] mt-0.5 font-mono"
                style={{ color: 'hsl(var(--text-mid))' }}
              >
                Open .tethr file · audio restored automatically
              </div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-foreground shrink-0">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".tethr,application/json"
            onChange={handleFileChange}
          />
        </div>

        {status.kind === 'success' && (
          <div
            className="flex items-center gap-2 px-3 py-2 border text-[11px]"
            style={{
              background: 'hsl(258 30% 10%)',
              borderColor: 'hsl(258 70% 40%)',
              color: 'hsl(224 22% 76%)',
            }}
          >
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>{status.msg}</span>
          </div>
        )}

        {status.kind === 'error' && (
          <div
            className="flex items-start gap-2 px-3 py-2 border text-[11px]"
            style={{
              background: 'hsl(286 24% 9%)',
              borderColor: 'hsl(286 48% 42%)',
              color: 'hsl(224 22% 76%)',
            }}
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{status.msg}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
