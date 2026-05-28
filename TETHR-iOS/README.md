# TETHR iOS

Native SwiftUI foundation for NIGHTSHAPE TETHR.

TETHR shares the NIGHTSHAPE visual universe with DRUMKIT, but this app is a separate precision audio repair instrument. The existing React/Web Audio project remains a prototype/reference for workflow and algorithm behavior.

## Backend Integration Points

- `Models/TethrComposition.swift` owns source tracks, shared segment maps, mutually exclusive segment selections, and derived composite plans.
- `Analysis/TethrSharedSegmentAnalyzer.swift` defines the paired-analysis seam. Replace `TethrPlaceholderSharedSegmentAnalyzer` with the real joint analysis engine when ready.
- `Audio/TethrCompositePlanner.swift` turns shared segments plus active source choices into ordered playback/export slices.
- `ViewModels/TethrEditorViewModel.swift` publishes `composition` so the final UI template can bind to sources, shared segments, selections, and composite plan state.

## Validate

```sh
xcodebuild -project TETHR_iOS.xcodeproj -scheme TETHR_iOS -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/tethr-ios-derived build
```
