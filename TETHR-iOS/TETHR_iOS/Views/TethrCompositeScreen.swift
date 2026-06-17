import SwiftUI

// MARK: - Take / drift display types

enum TethrTake: String, CaseIterable, Equatable, Identifiable {
    case A
    case B

    var id: String { rawValue }
    var label: String { "TAKE \(rawValue)" }
    var color: Color { self == .A ? TethrTheme.cyan : TethrTheme.magenta }
}

enum TethrDriftDirection: String, Equatable {
    case forward
    case back
    case on

    var sign: String {
        switch self {
        case .forward: return "+"
        case .back:    return "−"
        case .on:      return "±"
        }
    }

    var color: Color {
        switch self {
        case .on:      return TethrTheme.cyan
        case .forward: return TethrTheme.peri
        case .back:    return TethrTheme.magenta
        }
    }
}

// MARK: - Composite screen

struct TethrCompositeScreen: View {
    @ObservedObject var viewModel: TethrEditorViewModel
    @ObservedObject var orientationLock: OrientationLockManager
    let isLandscape: Bool

    @State private var headFrac: Double = 0
    @State private var isPlaying: Bool = false
    @State private var animationTimer: Timer?
    @State private var isBpmSheetPresented: Bool = false

    // MARK: Real composition data

    private var loadedSources: [TethrSourceTrack] { viewModel.composition.sources }
    /// The optional second take. Nil keeps TAKE B an empty (importable) slot.
    private var takeBSource: TethrSourceTrack? { viewModel.composition.source(in: .alternate) }
    private var realSegments: [TethrSharedSegment] {
        viewModel.composition.sharedSegmentMap?.segments ?? []
    }
    private var realBpm: Double {
        viewModel.composition.sharedSegmentMap?.detectedBpm
            ?? viewModel.project.detectedBpm
            ?? Double(viewModel.currentMasterBpm)
    }
    private var realTotalDuration: TimeInterval {
        realSegments.last?.endTime ?? loadedSources.first?.duration ?? 0
    }
    private var realTotalBars: Int {
        guard realBpm > 0, realTotalDuration > 0 else { return 1 }
        return max(1, Int((realTotalDuration / (60 / realBpm) / 4).rounded()))
    }

    private var activeRealSegmentIndex: Int? {
        guard realTotalDuration > 0 else { return nil }
        let t = max(0, min(0.9999, headFrac)) * realTotalDuration
        return realSegments.first { t >= $0.startTime && t < $0.endTime }?.index
    }

    private func realHeadFraction(in segment: TethrSharedSegment) -> Double {
        guard segment.duration > 0 else { return 0 }
        let t = max(0, min(0.9999, headFrac)) * realTotalDuration
        return max(0, min(1, (t - segment.startTime) / segment.duration))
    }

    /// Average beat drift within a segment, derived from the real beat markers.
    private func driftSummary(for segment: TethrSharedSegment) -> (ms: Int, direction: TethrDriftDirection) {
        guard let map = viewModel.composition.sharedSegmentMap,
              let bpm = map.detectedBpm, bpm > 0 else { return (0, .on) }
        let beatInterval = 60 / bpm
        let drifts = map.beatMarkers.compactMap { marker -> Double? in
            let corrected = Double(marker.beatIndex) * beatInterval
            guard corrected >= segment.startTime, corrected < segment.endTime else { return nil }
            return marker.detectedTime - corrected
        }
        guard !drifts.isEmpty else { return (0, .on) }
        let avgMs = Int((drifts.reduce(0, +) / Double(drifts.count) * 1000).rounded())
        if abs(avgMs) <= 3 { return (abs(avgMs), .on) }
        return (abs(avgMs), avgMs > 0 ? .forward : .back)
    }

    /// The take currently routed (live) for a segment; defaults to the primary.
    private func liveSlot(for segment: TethrSharedSegment) -> TethrSourceSlot {
        guard let id = viewModel.composition.activeSourceID(for: segment.id),
              let source = viewModel.composition.source(id: id) else { return .primary }
        return source.slot
    }

    private func route(_ slot: TethrSourceSlot, for segment: TethrSharedSegment) {
        guard let source = viewModel.composition.source(in: slot) else { return }
        viewModel.selectSource(source.id, for: segment.id)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                VStack(spacing: 0) {
                    TethrCompositeTopBar(
                        bpm: viewModel.currentMasterBpm,
                        orientationLock: orientationLock,
                        safeAreaTop: isLandscape ? 18 : max(50, geo.safeAreaInsets.top + 8),
                        isExporting: viewModel.exportState == .exporting,
                        onImport: viewModel.returnToEmpty,
                        onExport: viewModel.exportComposite,
                        onMenu: { /* hook later */ },
                        onOpenBpm: { isBpmSheetPresented = true }
                    )

                    TethrLaneHeader(
                        takeAName: viewModel.project.sourceName ?? "—",
                        takeABpm: viewModel.currentMasterBpm,
                        takeADuration: realTotalDuration,
                        takeB: takeBSource
                    )

                    segmentList

                    TethrCompositeTransport(
                        isPlaying: $isPlaying,
                        headFrac: $headFrac,
                        bpm: viewModel.currentMasterBpm,
                        totalBars: realTotalBars,
                        safeAreaBottom: max(12, geo.safeAreaInsets.bottom),
                        onStop: {
                            isPlaying = false
                            headFrac = 0
                        }
                    )
                }
                .background(TethrTheme.bg0)

                if isBpmSheetPresented {
                    TethrBpmSheet(
                        applied: viewModel.currentMasterBpm,
                        originalBpm: Int(viewModel.project.detectedBpm?.rounded() ?? 120),
                        onCancel: { isBpmSheetPresented = false },
                        onApply: { newBpm in
                            viewModel.setMasterBpm(newBpm)
                            isBpmSheetPresented = false
                        }
                    )
                    .transition(.opacity)
                }
            }
        }
        .onChange(of: isPlaying) { _, playing in
            if playing { startTicker() } else { stopTicker() }
        }
        .onDisappear { stopTicker() }
        .alert(
            exportAlertTitle,
            isPresented: Binding(
                get: { isExportResult(viewModel.exportState) },
                set: { if !$0 { viewModel.exportState = .idle } }
            )
        ) {
            Button("OK", role: .cancel) { viewModel.exportState = .idle }
        } message: {
            Text(exportAlertMessage)
        }
    }

    private func isExportResult(_ state: TethrExportState) -> Bool {
        switch state {
        case .success, .failure: return true
        case .idle, .exporting:  return false
        }
    }

    private var exportAlertTitle: String {
        if case .failure = viewModel.exportState { return "EXPORT FAILED" }
        return "EXPORTED"
    }

    private var exportAlertMessage: String {
        switch viewModel.exportState {
        case .success(let fileName): return "Saved \(fileName) to TETHR Exports."
        case .failure(let message):  return message
        case .idle, .exporting:      return ""
        }
    }

    // MARK: Segment list

    @ViewBuilder
    private var segmentList: some View {
        if realSegments.isEmpty {
            VStack(spacing: 10) {
                Spacer()
                Text("NO SEGMENTS")
                    .font(TethrFont.medium(11))
                    .tracking(11 * 0.22)
                    .foregroundStyle(TethrTheme.fg3)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(TethrTheme.bg0)
        } else {
            GeometryReader { geo in
                let spacing: CGFloat = 2
                let minRow: CGFloat = 84    // compact, scrollable
                let maxRow: CGFloat = 150   // tallest a row should ever stretch
                let count = CGFloat(realSegments.count)
                let available = geo.size.height - 4 // for the VStack padding
                let fit = (available - (count - 1) * spacing) / max(count, 1)

                if fit < minRow {
                    // Too many segments to fit: fixed compact rows, scrolls.
                    ScrollView {
                        VStack(spacing: spacing) {
                            ForEach(realSegments) { seg in
                                segmentRow(seg).frame(height: minRow)
                            }
                        }
                        .padding(2)
                    }
                    .frame(width: geo.size.width, height: geo.size.height)
                } else {
                    // Few segments: stretch to fill, but cap height so rows stay
                    // intentional rather than ballooning on tall screens.
                    let rowHeight = min(fit, maxRow)
                    VStack(spacing: spacing) {
                        ForEach(realSegments) { seg in
                            segmentRow(seg).frame(height: rowHeight)
                        }
                    }
                    .padding(2)
                    .frame(width: geo.size.width, height: geo.size.height, alignment: .center)
                }
            }
            .background(TethrTheme.bg0)
        }
    }

    // TAKE A (primary) · route gutter · TAKE B (real if loaded, else an empty
    // slot that imports a second take). The live take per segment is routable.
    @ViewBuilder
    private func segmentRow(_ seg: TethrSharedSegment) -> some View {
        let drift = driftSummary(for: seg)
        let active = seg.index == activeRealSegmentIndex
        let live = liveSlot(for: seg)
        let headFraction = active ? realHeadFraction(in: seg) : 0

        HStack(spacing: 2) {
            TethrRealTakeCell(
                segment: seg,
                accent: TethrTheme.cyan,
                isLive: live == .primary,
                driftMs: drift.ms,
                driftDirection: drift.direction,
                isHead: isPlaying && active && live == .primary,
                headFraction: headFraction,
                seed: Double(seg.index) * 1.7,
                onSelect: { route(.primary, for: seg) }
            )

            TethrRouteGutter(
                segmentNumber: String(format: "%02d", seg.index),
                live: live == .alternate ? .B : .A,
                isHead: isPlaying && active
            )
            .frame(width: 54)

            if takeBSource != nil {
                TethrRealTakeCell(
                    segment: seg,
                    accent: TethrTheme.magenta,
                    isLive: live == .alternate,
                    driftMs: drift.ms,
                    driftDirection: drift.direction,
                    isHead: isPlaying && active && live == .alternate,
                    headFraction: headFraction,
                    seed: Double(seg.index) * 1.7 + 0.9,
                    onSelect: { route(.alternate, for: seg) }
                )
            } else {
                TethrEmptySlotCell(onTap: {
                    #if DEBUG
                    // DEBUG-IMPORT-FIXTURE: deterministic TAKE B for the simulator
                    // (no Files/Music). Release uses the real picker.
                    viewModel.importDebugFixture(slot: .alternate)
                    #else
                    viewModel.presentImport(slot: .alternate)
                    #endif
                })
            }
        }
    }

    private func startTicker() {
        stopTicker()
        let totalSeconds = max(0.5, realTotalDuration)
        let start = Date()
        let startFrac = headFrac
        animationTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { _ in
            let elapsed = Date().timeIntervalSince(start)
            let advance = elapsed / max(0.001, totalSeconds)
            let next = (startFrac + advance).truncatingRemainder(dividingBy: 1.0)
            headFrac = next
        }
    }

    private func stopTicker() {
        animationTimer?.invalidate()
        animationTimer = nil
    }
}

// MARK: - Top bar

private struct TethrCompositeTopBar: View {
    let bpm: Int
    @ObservedObject var orientationLock: OrientationLockManager
    let safeAreaTop: CGFloat
    let isExporting: Bool
    let onImport: () -> Void
    let onExport: () -> Void
    let onMenu: () -> Void
    let onOpenBpm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                TethrCompositeWordmark(size: 36)

                Spacer(minLength: 8)

                TethrOrientationLockButton(manager: orientationLock)

                TethrChromeIconButton(action: onImport) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 13, weight: .semibold))
                }

                TethrChromeIconButton(action: isExporting ? {} : onExport) {
                    if isExporting {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(TethrTheme.cyan)
                    } else {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 13, weight: .semibold))
                    }
                }

                TethrChromeIconButton(action: onMenu) {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 13, weight: .semibold))
                }
            }

            TethrBpmPill(bpm: bpm, action: onOpenBpm)
        }
        .padding(.horizontal, 14)
        .padding(.top, safeAreaTop)
        .padding(.bottom, 12)
        .background(TethrTheme.bg0)
        .overlay(
            Rectangle()
                .fill(TethrTheme.line1)
                .frame(height: 1),
            alignment: .bottom
        )
    }
}

private struct TethrCompositeWordmark: View {
    var size: CGFloat = 36

    var body: some View {
        Text("TETHR")
            .font(TethrFont.bold(size))
            .tracking(size * 0.04)
            .foregroundStyle(
                LinearGradient(
                    stops: [
                        .init(color: Color(red: 51 / 255, green: 204 / 255, blue: 204 / 255).opacity(0.88), location: 0.00),
                        .init(color: Color(red: 52 / 255, green: 184 / 255, blue: 220 / 255).opacity(0.84), location: 0.34),
                        .init(color: Color(red: 102 / 255, green: 102 / 255, blue: 255 / 255).opacity(0.78), location: 0.70),
                        .init(color: Color(red: 153 / 255, green: 51 / 255, blue: 255 / 255).opacity(0.68), location: 1.00)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
    }
}

private struct TethrChromeIconButton<Label: View>: View {
    let action: () -> Void
    @ViewBuilder var label: () -> Label

    var body: some View {
        Button(action: action) {
            label()
                .foregroundStyle(TethrTheme.fg1)
                .frame(width: 40, height: 40)
                .overlay(
                    Rectangle().stroke(TethrTheme.line2, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

private struct TethrBpmPill: View {
    let bpm: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text("\(bpm)")
                    .font(TethrFont.medium(23))
                    .foregroundStyle(TethrTheme.fg0)
                    .monospacedDigit()

                Text("BPM")
                    .font(TethrFont.medium(11))
                    .tracking(11 * 0.18)
                    .foregroundStyle(TethrTheme.fg2)

                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(TethrTheme.fg2)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(TethrTheme.cyan.opacity(0.045))
            .overlay(
                Rectangle().stroke(TethrTheme.cyan, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Lane header (TAKE A real · TAKE B real or empty)

private func tethrTimecode(_ seconds: TimeInterval) -> String {
    guard seconds.isFinite, seconds > 0 else { return "0:00" }
    let total = Int(seconds.rounded())
    return String(format: "%d:%02d", total / 60, total % 60)
}

private struct TethrLaneHeader: View {
    let takeAName: String
    let takeABpm: Int
    let takeADuration: TimeInterval
    let takeB: TethrSourceTrack?

    var body: some View {
        HStack(spacing: 12) {
            // TAKE A — primary loaded track
            HStack(spacing: 7) {
                Rectangle()
                    .fill(TethrTheme.cyan)
                    .frame(width: 7, height: 7)

                Text(takeAName)
                    .font(TethrFont.medium(11))
                    .tracking(11 * 0.18)
                    .foregroundStyle(TethrTheme.fg0)
                    .lineLimit(1)
                    .truncationMode(.middle)

                Text("\(takeABpm) · \(tethrTimecode(takeADuration))")
                    .font(TethrFont.medium(9))
                    .tracking(9 * 0.12)
                    .foregroundStyle(TethrTheme.fg3)
                    .monospacedDigit()
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text("ROUTE")
                .font(TethrFont.medium(9))
                .tracking(9 * 0.3)
                .foregroundStyle(TethrTheme.fg3)

            // TAKE B — real second take, or an empty slot
            HStack(spacing: 7) {
                if let takeB {
                    Text(takeB.fileName)
                        .font(TethrFont.medium(11))
                        .tracking(11 * 0.18)
                        .foregroundStyle(TethrTheme.fg0)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    Rectangle()
                        .fill(TethrTheme.magenta)
                        .frame(width: 7, height: 7)
                } else {
                    Text("EMPTY")
                        .font(TethrFont.medium(9))
                        .tracking(9 * 0.18)
                        .foregroundStyle(TethrTheme.fg4)

                    Text("TAKE B")
                        .font(TethrFont.medium(11))
                        .tracking(11 * 0.24)
                        .foregroundStyle(TethrTheme.fg3)

                    Rectangle()
                        .fill(TethrTheme.fg4.opacity(0.5))
                        .frame(width: 7, height: 7)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .overlay(
            Rectangle()
                .fill(TethrTheme.line1)
                .frame(height: 1),
            alignment: .bottom
        )
    }
}

/// Empty TAKE B slot — renders no waveform/segment data until a second take is
/// loaded; tapping imports a second take through the same import pipeline.
private struct TethrEmptySlotCell: View {
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            ZStack {
                Rectangle()
                    .fill(Color(red: 9 / 255, green: 9 / 255, blue: 11 / 255).opacity(0.5))

                VStack(spacing: 4) {
                    Text("EMPTY")
                        .font(TethrFont.medium(9))
                        .tracking(9 * 0.24)
                        .foregroundStyle(TethrTheme.fg4)

                    Text("TAP TO IMPORT")
                        .font(TethrFont.medium(8))
                        .tracking(8 * 0.22)
                        .foregroundStyle(TethrTheme.magenta.opacity(0.7))
                }
            }
            .overlay(
                Rectangle()
                    .stroke(TethrTheme.line1, style: StrokeStyle(lineWidth: 1, dash: [4, 5]))
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct TethrRealTakeCell: View {
    let segment: TethrSharedSegment
    let accent: Color
    let isLive: Bool
    let driftMs: Int
    let driftDirection: TethrDriftDirection
    let isHead: Bool
    let headFraction: Double
    let seed: Double
    let onSelect: () -> Void

    var body: some View {
        Button(action: { if !isLive { onSelect() } }) {
            GeometryReader { geo in
                ZStack(alignment: .topLeading) {
                    Rectangle()
                        .fill(isLive ? accent.opacity(0.04) : Color(red: 9 / 255, green: 9 / 255, blue: 11 / 255).opacity(0.68))

                    if isLive && isHead {
                        Rectangle()
                            .fill(TethrTheme.magenta.opacity(0.10))
                            .allowsHitTesting(false)
                    }

                    TethrSynthWaveform(
                        color: isLive ? accent : TethrTheme.fg3,
                        seed: seed,
                        energy: 0.6,
                        flat: !isLive,
                        intensity: isLive ? 0.6 : 0.12
                    )
                    .padding(.horizontal, 4)
                    .padding(.vertical, 5)
                    .allowsHitTesting(false)

                    if isLive && isHead {
                        Rectangle()
                            .fill(TethrTheme.magenta)
                            .frame(width: 2)
                            .shadow(color: TethrTheme.magenta.opacity(0.7), radius: 4)
                            .offset(x: geo.size.width * headFraction)
                            .allowsHitTesting(false)
                    }

                    HStack(alignment: .top) {
                        VStack(alignment: .leading) {
                            Text(segment.label)
                                .font(TethrFont.medium(12))
                                .tracking(12 * 0.16)
                                .foregroundStyle(isLive ? TethrTheme.fg0 : TethrTheme.fg2)

                            Spacer(minLength: 0)

                            if isLive {
                                TethrDriftChip(direction: driftDirection, driftMs: driftMs)
                            } else {
                                Text("TAP TO USE")
                                    .font(TethrFont.medium(9))
                                    .tracking(9 * 0.16)
                                    .foregroundStyle(TethrTheme.fg3)
                            }
                        }

                        Spacer(minLength: 0)

                        Text(tethrTimecode(segment.duration))
                            .font(TethrFont.medium(9))
                            .tracking(9 * 0.12)
                            .foregroundStyle(TethrTheme.fg3)
                            .monospacedDigit()
                    }
                    .padding(.horizontal, 11)
                    .padding(.vertical, 8)
                }
                .overlay(
                    Rectangle()
                        .stroke(isLive ? accent : TethrTheme.line1, lineWidth: 1)
                )
                .opacity(isLive ? 1 : 0.62)
                .contentShape(Rectangle())
            }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct TethrDriftChip: View {
    let direction: TethrDriftDirection
    let driftMs: Int

    var body: some View {
        HStack(spacing: 4) {
            Rectangle()
                .fill(direction.color)
                .frame(width: 5, height: 5)

            Text("\(direction.sign)\(driftMs)MS")
                .font(TethrFont.medium(9))
                .tracking(9 * 0.16)
                .foregroundStyle(TethrTheme.fg2)
                .monospacedDigit()
        }
    }
}

private struct TethrRouteGutter: View {
    let segmentNumber: String
    let live: TethrTake
    let isHead: Bool

    var body: some View {
        VStack(spacing: 3) {
            Text(segmentNumber)
                .font(TethrFont.medium(11))
                .tracking(11 * 0.04)
                .foregroundStyle(isHead ? TethrTheme.magenta : TethrTheme.fg1)
                .monospacedDigit()

            TethrRouteMarker(live: live)
                .frame(width: 22, height: 22)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 8/255, green: 8/255, blue: 10/255).opacity(0.72))
        .overlay(
            Rectangle()
                .fill(TethrTheme.line1)
                .frame(width: 1),
            alignment: .leading
        )
        .overlay(
            Rectangle()
                .fill(TethrTheme.line1)
                .frame(width: 1),
            alignment: .trailing
        )
    }
}

private struct TethrRouteMarker: View {
    let live: TethrTake

    var body: some View {
        // Play triangle pointing left for A, right for B
        Image(systemName: "play.fill")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(live.color)
            .rotationEffect(live == .A ? .degrees(180) : .zero)
            .shadow(color: live.color.opacity(0.5), radius: 4)
    }
}

// MARK: - BPM sheet

struct TethrBpmSheet: View {
    let applied: Int
    let originalBpm: Int
    let onCancel: () -> Void
    let onApply: (Int) -> Void

    @State private var draft: Double
    @State private var dragBase: Double = 0
    @State private var isDragging: Bool = false
    @State private var isEditing: Bool = false
    @State private var typed: String = ""
    @State private var tapTimes: [Date] = []
    @State private var tapCount: Int = 0
    @FocusState private var fieldFocused: Bool

    private let bpmRange: ClosedRange<Double> = 60...200

    init(applied: Int, originalBpm: Int, onCancel: @escaping () -> Void, onApply: @escaping (Int) -> Void) {
        self.applied = applied
        self.originalBpm = originalBpm
        self.onCancel = onCancel
        self.onApply = onApply
        self._draft = State(initialValue: Double(applied))
    }

    private var changed: Bool { Int(draft.rounded()) != applied }
    private var delta: Int { Int(draft.rounded()) - originalBpm }
    private var accent: Color { changed ? TethrTheme.violet : TethrTheme.cyan }

    var body: some View {
        ZStack {
            Color.black.opacity(0.78)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture(perform: onCancel)

            VStack {
                Spacer(minLength: 0)

                sheetCard
                    .padding(.horizontal, 0)
            }
            .ignoresSafeArea(edges: .bottom)
        }
        .transition(.opacity)
    }

    private var sheetCard: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack {
                Text("MASTER OUTPUT BPM")
                    .font(TethrFont.medium(13))
                    .tracking(13 * 0.3)
                    .foregroundStyle(TethrTheme.fg0)

                Spacer()

                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(TethrTheme.fg2)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
            }

            HStack(alignment: .center, spacing: 12) {
                valueControl
                tapTempoButton
            }

            HStack {
                Text("60")
                    .font(TethrFont.medium(9))
                    .tracking(9 * 0.2)
                    .foregroundStyle(TethrTheme.fg3)

                Spacer()

                HStack(spacing: 6) {
                    Text("DETECTED \(originalBpm)")
                        .font(TethrFont.medium(10))
                        .tracking(10 * 0.2)
                        .foregroundStyle(TethrTheme.fg2)

                    if delta != 0 {
                        Text(deltaString)
                            .font(TethrFont.medium(10))
                            .tracking(10 * 0.1)
                            .foregroundStyle(TethrTheme.magenta)
                            .monospacedDigit()
                    }
                }

                Spacer()

                Text("200")
                    .font(TethrFont.medium(9))
                    .tracking(9 * 0.2)
                    .foregroundStyle(TethrTheme.fg3)
            }

            HStack(spacing: 10) {
                sheetActionButton(label: "CANCEL", accent: TethrTheme.fg2, active: true, action: onCancel)

                sheetActionButton(
                    label: "APPLY",
                    accent: TethrTheme.cyan,
                    active: changed,
                    action: {
                        if changed { onApply(Int(draft.rounded())) }
                    }
                )
            }
        }
        .padding(24)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TethrTheme.bg1)
        .overlay(
            Rectangle()
                .stroke(TethrTheme.line2, lineWidth: 1),
            alignment: .top
        )
    }

    @ViewBuilder
    private var valueControl: some View {
        let displayValue = Int(draft.rounded())

        ZStack {
            Rectangle()
                .fill(accent.opacity(0.04))
                .overlay(
                    Rectangle().stroke(accent, lineWidth: 1)
                )

            VStack(spacing: 8) {
                if isEditing {
                    TextField("", text: $typed)
                        .font(TethrFont.medium(56))
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(accent)
                        .monospacedDigit()
                        .focused($fieldFocused)
                        .onSubmit { commitTyped() }
                        .onChange(of: fieldFocused) { _, focused in
                            if !focused { commitTyped() }
                        }
                } else {
                    Text("\(displayValue)")
                        .font(TethrFont.medium(60))
                        .foregroundStyle(changed ? TethrTheme.violet : TethrTheme.fg0)
                        .monospacedDigit()
                        .shadow(color: accent.opacity(0.24), radius: 18)
                }

                Text("BEATS PER MINUTE")
                    .font(TethrFont.medium(10))
                    .tracking(10 * 0.34)
                    .foregroundStyle(TethrTheme.fg2)
            }
            .padding(.vertical, 12)
        }
        .frame(minHeight: 128)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 2)
                .onChanged { value in
                    guard !isEditing else { return }
                    if !isDragging {
                        isDragging = true
                        dragBase = draft
                    }
                    let next = dragBase - Double(value.translation.height) * 0.12
                    draft = next.clamped(to: bpmRange)
                }
                .onEnded { _ in
                    isDragging = false
                }
        )
        .onTapGesture(count: 2) {
            beginEditing()
        }
    }

    private var tapTempoButton: some View {
        Button(action: registerTap) {
            VStack(spacing: 8) {
                Text("TAP")
                    .font(TethrFont.medium(14))
                    .tracking(14 * 0.2)
                    .foregroundStyle(tapCount > 1 ? TethrTheme.cyan : TethrTheme.fg1)

                HStack(spacing: 3) {
                    ForEach(0..<4, id: \.self) { i in
                        Rectangle()
                            .fill(i < tapCount ? TethrTheme.cyan : TethrTheme.fg4)
                            .frame(width: 5, height: 5)
                    }
                }
            }
            .frame(width: 88, height: 128)
            .background(tapCount > 1 ? TethrTheme.cyan.opacity(0.055) : Color.clear)
            .overlay(
                Rectangle().stroke(tapCount > 1 ? TethrTheme.cyan : TethrTheme.line2, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func sheetActionButton(label: String, accent: Color, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(TethrFont.medium(13))
                .tracking(13 * 0.28)
                .foregroundStyle(active ? accent : accent.opacity(0.4))
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(active ? accent.opacity(0.055) : Color.clear)
                .overlay(
                    Rectangle().stroke(active ? accent : TethrTheme.line2, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .disabled(!active)
    }

    private var deltaString: String {
        delta > 0 ? "+\(delta)" : "−\(abs(delta))"
    }

    private func beginEditing() {
        typed = "\(Int(draft.rounded()))"
        isEditing = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            fieldFocused = true
        }
    }

    private func commitTyped() {
        let stripped = typed.filter { $0.isNumber }
        if let n = Int(stripped) {
            draft = Double(n).clamped(to: bpmRange)
        }
        isEditing = false
        fieldFocused = false
    }

    private func registerTap() {
        let now = Date()
        let cutoff = now.addingTimeInterval(-2.4)
        var fresh = tapTimes.filter { $0 > cutoff }
        fresh.append(now)
        if fresh.count > 6 { fresh.removeFirst(fresh.count - 6) }
        tapTimes = fresh
        tapCount = min(4, fresh.count)

        guard fresh.count >= 2 else { return }
        let intervals = zip(fresh.dropFirst(), fresh).map { $0.timeIntervalSince($1) }
        let avg = intervals.reduce(0, +) / Double(intervals.count)
        guard avg > 0 else { return }
        let bpm = 60.0 / avg
        draft = bpm.clamped(to: bpmRange)
    }
}

private extension Double {
    func clamped(to range: ClosedRange<Double>) -> Double {
        Swift.min(range.upperBound, Swift.max(range.lowerBound, self))
    }
}

// MARK: - Synthesized waveform

struct TethrSynthWaveform: View {
    let color: Color
    let seed: Double
    let energy: Double
    var flat: Bool = false
    var intensity: Double = 0.6
    var count: Int = 48

    var body: some View {
        Canvas { ctx, size in
            let ceiling = flat ? 0.38 : 0.76
            let floor = flat ? 0.035 : 0.06
            let barW = max(0.5, (size.width - Double(count - 1)) / Double(count))
            let centerY = size.height / 2

            for i in 0..<count {
                let t = Double(i) / Double(count)
                let env = 0.42
                    + sin(t * .pi * 3 + seed) * 0.16
                    + sin(t * .pi * 7 + seed * 2) * 0.10
                    + sin(Double(i) * 1.93 + seed * 3) * 0.16
                    + sin(Double(i) * 0.71 + seed) * 0.10
                let h = max(floor, min(ceiling, env * (0.45 + energy * 0.58)))
                let barH = h * size.height
                let x = (barW + 1) * Double(i)
                let rect = CGRect(x: x, y: centerY - barH / 2, width: barW, height: barH)

                let opacity = flat
                    ? 0.32 + h * 0.32
                    : 0.78 + h * 0.18
                ctx.fill(Path(rect), with: .color(color.opacity(opacity * (flat ? max(0.4, intensity) : 1))))
            }
        }
    }
}

// MARK: - Transport

private struct TethrCompositeTransport: View {
    @Binding var isPlaying: Bool
    @Binding var headFrac: Double
    let bpm: Int
    var totalBars: Int = 116
    let safeAreaBottom: CGFloat
    let onStop: () -> Void

    private var bar: Int { Int(headFrac * Double(totalBars)) + 1 }
    private var beat: Int { Int((headFrac * Double(totalBars) * 4).truncatingRemainder(dividingBy: 4)) + 1 }
    private var primaryColor: Color { isPlaying ? TethrTheme.magenta : TethrTheme.violet }

    var body: some View {
        HStack(spacing: 16) {
            // play / pause
            Button(action: { isPlaying.toggle() }) {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(primaryColor)
                    .frame(width: 50, height: 50)
                    .background(primaryColor.opacity(0.05))
                    .overlay(Rectangle().stroke(primaryColor, lineWidth: 1))
                    .shadow(color: primaryColor.opacity(0.3), radius: 5, y: 0)
            }
            .buttonStyle(.plain)

            // stop
            Button(action: onStop) {
                Image(systemName: "stop.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(TethrTheme.fg1)
                    .frame(width: 44, height: 44)
                    .overlay(Rectangle().stroke(TethrTheme.line2, lineWidth: 1))
            }
            .buttonStyle(.plain)

            // bar · beat
            VStack(alignment: .leading, spacing: 3) {
                Text("BAR · BEAT")
                    .font(TethrFont.medium(9))
                    .tracking(9 * 0.22)
                    .foregroundStyle(TethrTheme.magenta)

                Text("\(bar):\(beat):00")
                    .font(TethrFont.medium(19))
                    .foregroundStyle(TethrTheme.fg0)
                    .monospacedDigit()
            }

            // scrub
            Slider(
                value: $headFrac,
                in: 0...1
            )
            .tint(TethrTheme.cyan)
        }
        .padding(.horizontal, 14)
        .padding(.bottom, safeAreaBottom)
        .frame(minHeight: 68 + safeAreaBottom)
        .background(Color(red: 8/255, green: 8/255, blue: 10/255).opacity(0.82))
        .overlay(
            Rectangle()
                .fill(TethrTheme.line1)
                .frame(height: 1),
            alignment: .top
        )
    }
}
