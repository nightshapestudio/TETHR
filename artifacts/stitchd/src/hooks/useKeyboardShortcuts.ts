import { useEffect } from 'react';
import { useProjectStore } from '../store/useProjectStore';

export function useKeyboardShortcuts() {
  const {
    playbackState,
    setPlaybackState,
    selectedClipId,
    removeArrangementClip,
    duplicateArrangementClip,
    arrangementClips,
    addArrangementClip,
    undo,
    redo,
    selectedTrackId,
    updateTrack,
    tracks,
    setReferenceTrack,
    updateArrangementClip,
    setZoom,
    zoomLevel,
    setToolMode,
    isApplyingTempo
  } = useProjectStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          // Block play/pause while a tempo change is rendering. Stop (Esc/Enter)
          // remains available below as an escape hatch.
          if (isApplyingTempo) break;
          setPlaybackState(playbackState === 'playing' ? 'paused' : 'playing');
          break;
        case 'Escape':
        case 'Enter':
          e.preventDefault();
          setPlaybackState('stopped');
          break;
        case 'Backspace':
        case 'Delete':
          if (selectedClipId) {
            removeArrangementClip(selectedClipId);
          }
          break;
        case 'v':
        case 'V':
          setToolMode('select');
          break;
        case 's':
        case 'S':
          setToolMode('slip');
          break;
        case 'x':
        case 'X':
          setToolMode('split');
          break;
        case 'w':
        case 'W':
          setToolMode('warp');
          break;
        case 'c':
        case 'C':
          if (e.metaKey || e.ctrlKey) {
            // copy - just let duplicate handle it for now as a simple fallback
          }
          break;
        case 'd':
        case 'D':
          if ((e.metaKey || e.ctrlKey) && selectedClipId) {
            e.preventDefault();
            duplicateArrangementClip(selectedClipId);
          }
          break;
        case 'z':
        case 'Z':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (e.shiftKey) {
              redo();
            } else {
              undo();
            }
          }
          break;
        case 'y':
        case 'Y':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            redo();
          }
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          if (selectedClipId) {
            const clip = arrangementClips.find(c => c.id === selectedClipId);
            if (clip) {
              const amount = e.shiftKey ? 1 : 0.01; // 1s vs 10ms
              const direction = e.key === 'ArrowLeft' ? -1 : 1;
              updateArrangementClip(clip.id, {
                nudgeOffset: clip.nudgeOffset + (amount * direction * 1000)
              });
            }
          }
          break;
        case '[':
          setZoom(zoomLevel * 0.9);
          break;
        case ']':
          setZoom(zoomLevel * 1.1);
          break;
        case 'r':
        case 'R':
          if (tracks.length > 0) {
            const currentIdx = tracks.findIndex(t => t.isReference);
            const nextIdx = (currentIdx + 1) % tracks.length;
            setReferenceTrack(tracks[nextIdx].id);
          }
          break;
        case 'm':
        case 'M':
          if (selectedTrackId) {
            const track = tracks.find(t => t.id === selectedTrackId);
            if (track) updateTrack(track.id, { isMuted: !track.isMuted });
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    playbackState, setPlaybackState, selectedClipId, removeArrangementClip,
    duplicateArrangementClip, arrangementClips, addArrangementClip, undo, redo,
    selectedTrackId, updateTrack, tracks, setReferenceTrack, updateArrangementClip,
    zoomLevel, setZoom, setToolMode, isApplyingTempo
  ]);
}