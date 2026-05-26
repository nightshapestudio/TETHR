import React, { useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { ExportModal } from './ExportModal';
import { ProjectModal } from './ProjectModal';

/**
 * TopBar — the instrument header. Big brand presence, sparse utility
 * controls, and no generic desktop-app chrome.
 */
export function TopBar() {
  const undo = useProjectStore(s => s.undo);
  const redo = useProjectStore(s => s.redo);
  const [showExport, setShowExport] = useState(false);
  const [showProject, setShowProject] = useState(false);

  return (
    <div
      className="h-[154px] shrink-0 flex items-start justify-between px-6 pt-9 relative z-30"
      style={{
        background:
          'linear-gradient(180deg, hsl(240 8% 5%) 0%, hsl(240 8% 5%) 74%, hsl(240 8% 5% / 0.94) 100%)',
        borderBottom: '1px solid hsl(230 7% 9%)',
      }}
    >
      <div className="select-none">
        <div
          className="flex items-baseline"
          style={{
            fontFamily: 'var(--app-font-display)',
            fontWeight: 700,
            letterSpacing: '0.04em',
            fontSize: 'clamp(60px, 5.7vw, 112px)',
            textTransform: 'uppercase',
            lineHeight: 0.82,
            color: 'transparent',
            background:
              'linear-gradient(180deg, hsl(var(--signal)) 0%, hsl(240 76% 72%) 54%, hsl(270 72% 66%) 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            textShadow: '0 0 18px hsl(240 100% 70% / 0.10)',
          }}
          aria-label="TETHR"
        >
          TETHR
        </div>
      </div>

      <div className="flex items-center gap-9 pt-4">
        <button
          onClick={() => setShowProject(true)}
          className="h-8 px-2 text-[15px] uppercase tracking-[0.28em] text-primary hover:text-foreground hover:bg-white/[0.035] transition-colors"
          style={{ fontFamily: 'var(--app-font-ui)', fontWeight: 700 }}
        >
          Project
        </button>
        <button
          onClick={() => setShowExport(true)}
          className="h-8 px-2 text-[15px] uppercase tracking-[0.28em] text-primary hover:text-foreground hover:bg-white/[0.035] transition-colors"
          style={{ fontFamily: 'var(--app-font-ui)', fontWeight: 700 }}
        >
          Export
        </button>

        <span className="w-px h-7 bg-border/80" aria-hidden />

        <button
          onClick={undo}
          title="Undo (Cmd/Ctrl+Z)"
          className="w-9 h-9 flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-white/[0.035] transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v6h6" />
            <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
          </svg>
        </button>
        <button
          onClick={redo}
          title="Redo (Cmd/Ctrl+Shift+Z)"
          className="w-9 h-9 flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-white/[0.035] transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 7v6h-6" />
            <path d="M21 13a9 9 0 1 1-3-7.7L21 8" />
          </svg>
        </button>
      </div>

      <ExportModal open={showExport} onOpenChange={setShowExport} />
      <ProjectModal open={showProject} onOpenChange={setShowProject} />
    </div>
  );
}
