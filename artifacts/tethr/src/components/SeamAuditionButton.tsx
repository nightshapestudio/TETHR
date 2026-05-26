import React, { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Play, Square } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';

interface SeamAuditionButtonProps {
  clipId: string;
}

export function SeamAuditionButton({ clipId }: SeamAuditionButtonProps) {
  const {
    arrangementClips,
    playbackState,
    bpm,
    triggerPlay,
    setPlaybackState,
  } = useProjectStore();

  const isAuditioning = useRef(false);
  const [activeAudition, setActiveAudition] = useState(false);

  const clip = arrangementClips.find(c => c.id === clipId);

  // If playback stops/pauses externally, clear audition state
  useEffect(() => {
    if ((playbackState === 'stopped' || playbackState === 'paused') && isAuditioning.current) {
      isAuditioning.current = false;
      setActiveAudition(false);
      useProjectStore.setState({ isLooping: false, loopRegion: null });
    }
  }, [playbackState]);

  // Cleanup when a different clip is selected
  useEffect(() => {
    return () => {
      if (isAuditioning.current) {
        isAuditioning.current = false;
        useProjectStore.setState({ isLooping: false, loopRegion: null });
        setPlaybackState('stopped');
      }
    };
  }, [clipId]);

  const handleAudition = () => {
    if (!clip) return;

    if (activeAudition) {
      isAuditioning.current = false;
      setActiveAudition(false);
      useProjectStore.setState({ isLooping: false, loopRegion: null });
      setPlaybackState('stopped');
      return;
    }

    const secondsPerBar = bpm > 0 ? (60 / bpm) * 4 : 2;
    const preroll = secondsPerBar * 2;
    const postroll = secondsPerBar * 2;

    // Use actual output duration (source / stretchRatio) and account for nudge offset
    const nudgeSec = (clip.nudgeOffset || 0) / 1000;
    const outputDuration = clip.sourceDuration / Math.max(0.05, clip.stretchRatio || 1.0);
    const clipStart = clip.timelinePosition + nudgeSec;
    const clipEnd = clipStart + outputDuration;

    const regionStart = Math.max(0, clipStart - preroll);
    const regionEnd = clipEnd + postroll;

    // Set loop region and position atomically, then use triggerPlay which
    // bumps playTrigger so the audio engine restarts even if already playing
    useProjectStore.setState({
      isLooping: true,
      loopRegion: { start: regionStart, end: regionEnd },
    });

    isAuditioning.current = true;
    setActiveAudition(true);

    // triggerPlay sets playheadPosition + playbackState + bumps playTrigger atomically
    triggerPlay(regionStart);
  };

  if (!clip) return null;

  return (
    <Button
      variant={activeAudition ? 'default' : 'outline'}
      size="sm"
      data-testid="button-audition-seam"
      className={`w-full rounded-none uppercase tracking-[0.08em] text-xs ${
        activeAudition
          ? 'bg-transparent border border-primary text-primary shadow-[0_0_10px_hsl(var(--primary)/0.25)]'
          : 'bg-transparent border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
      }`}
      onClick={handleAudition}
    >
      {activeAudition
        ? <><Square className="w-3 h-3 mr-2 fill-current" /> Stop Seam Loop</>
        : <><Play className="w-3 h-3 mr-2 fill-current" /> Audition Seam (±2 bars)</>
      }
    </Button>
  );
}
