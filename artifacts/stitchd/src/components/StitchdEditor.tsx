import React, { useEffect } from 'react';
import { LeftSidebar } from './LeftSidebar';
import { Timeline } from './Timeline';
import { RightInspector } from './RightInspector';
import { Transport } from './Transport';
import { ApplyingTempoOverlay } from './ApplyingTempoOverlay';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useAudioEngine } from '../hooks/useAudioEngine';

export default function StitchdEditor() {
  // Initialize global hooks
  useKeyboardShortcuts();
  useAudioEngine(); // Starts audio context management

  return (
    <div className="flex flex-col h-screen w-screen bg-background overflow-hidden selection:bg-primary/30">
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar />
        <Timeline />
        <RightInspector />
      </div>
      <Transport />
      <ApplyingTempoOverlay />
    </div>
  );
}
