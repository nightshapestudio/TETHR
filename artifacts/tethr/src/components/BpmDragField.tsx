import React, { useRef, useState, useCallback, useEffect } from 'react';

interface BpmDragFieldProps {
  value: number;
  onChange: (bpm: number) => void;
  min?: number;
  max?: number;
  className?: string;
  label?: string;
}

export function BpmDragField({
  value,
  onChange,
  min = 30,
  max = 300,
  className = '',
  label = 'BPM',
}: BpmDragFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const dragRef = useRef<{ y: number; start: number } | null>(null);

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const clamp = useCallback(
    (v: number) => Math.max(min, Math.min(max, Math.round(v * 2) / 2)),
    [min, max],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return;
    e.preventDefault();
    dragRef.current = { y: e.clientY, start: value };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dy = dragRef.current.y - e.clientY;
    const step = e.shiftKey ? 0.1 : 0.5;
    const delta = dy * step;
    onChange(clamp(dragRef.current.start + delta));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const commitDraft = () => {
    const v = Number(draft);
    if (!isNaN(v) && v > 0) onChange(clamp(v));
    setEditing(false);
  };

  if (editing) {
    return (
      <div className={`relative ${className}`}>
        <input
          autoFocus
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft();
            if (e.key === 'Escape') {
              setDraft(String(value));
              setEditing(false);
            }
          }}
          min={min}
          max={max}
          step={0.5}
          className="w-full h-full bg-transparent font-mono text-[28px] text-foreground text-center outline-none border border-primary/45"
        />
      </div>
    );
  }

  return (
    <div
      role="spinbutton"
      aria-label={label}
      aria-valuenow={value}
      className={`relative cursor-ns-resize select-none touch-none ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => setEditing(true)}
      title="Drag up/down to change BPM · Shift = fine · Double-click to type"
    >
      <span className="block w-full h-full flex items-center justify-center font-mono text-[28px] text-foreground text-center tabular-nums">
        {value}
      </span>
      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground/50 pointer-events-none">
        {label}
      </span>
    </div>
  );
}
