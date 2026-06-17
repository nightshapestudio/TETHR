import SwiftUI
import UniformTypeIdentifiers

struct TethrRootView: View {
    @StateObject private var viewModel = TethrEditorViewModel()
    @EnvironmentObject private var orientationLock: OrientationLockManager

    var body: some View {
        GeometryReader { geo in
            let isLandscape = orientationLock.isLandscape && viewModel.appScreen == .composite
            let contentWidth = isLandscape ? geo.size.height : geo.size.width
            let contentHeight = isLandscape ? geo.size.width : geo.size.height

            ZStack {
                TethrTheme.bg0

                screenContent(isLandscape: isLandscape, geo: geo)
            }
            .frame(width: contentWidth, height: contentHeight)
            .rotationEffect(isLandscape ? .degrees(90) : .zero)
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .ignoresSafeArea()
        .background(TethrTheme.bg0)
        .preferredColorScheme(.dark)
        .fileImporter(
            isPresented: $viewModel.isImportPresented,
            allowedContentTypes: [.audio],
            allowsMultipleSelection: false,
            onCompletion: handleImport
        )
        .alert(
            "IMPORT FAILED",
            isPresented: Binding(
                get: { viewModel.importErrorMessage != nil },
                set: { if !$0 { viewModel.importErrorMessage = nil } }
            ),
            presenting: viewModel.importErrorMessage
        ) { _ in
            Button("OK", role: .cancel) { viewModel.importErrorMessage = nil }
        } message: { message in
            Text(message)
        }
    }

    @ViewBuilder
    private func screenContent(isLandscape: Bool, geo: GeometryProxy) -> some View {
        switch viewModel.appScreen {
        case .launch:
            TethrLaunchScreenStub(onDone: viewModel.advanceFromLaunch)
        case .empty:
            emptyShell(isLandscape: isLandscape, geo: geo)
        case .analyzing:
            TethrAnalyzingScreenStub()
        case .composite:
            TethrCompositeScreen(
                viewModel: viewModel,
                orientationLock: orientationLock,
                isLandscape: isLandscape
            )
        case .export:
            TethrExportScreenStub(onClose: viewModel.dismissExport)
        }
    }

    private func emptyShell(isLandscape: Bool, geo: GeometryProxy) -> some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                emptyHeader(isLandscape: isLandscape)
                emptyLanding
            }
            .padding(.horizontal, isLandscape ? 30 : 20)
            .padding(.top, isLandscape ? 38 : max(60, geo.safeAreaInsets.top + 24))
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            TethrStatusStrip(leading: "AUTO-CORRECT · SINGLE TRACK", trailing: "READY")
                .padding(.bottom, max(8, geo.safeAreaInsets.bottom))
        }
    }

    private func emptyHeader(isLandscape: Bool) -> some View {
        HStack(alignment: .top, spacing: 16) {
            TethrWordmark(size: isLandscape ? 64 : 60)
                .padding(.top, 2)

            Spacer(minLength: 10)

            TethrOrientationLockButton(manager: orientationLock)
                .padding(.top, 2)
        }
    }

    private var emptyLanding: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 0)

            TethrEmptyImportPanel(
                action: { viewModel.presentImport(slot: .primary) },
                isLandscape: orientationLock.lock == .landscape
            )
            .offset(y: orientationLock.lock == .landscape ? 14 : 26)

#if DEBUG
            // DEBUG-IMPORT-FIXTURE: deterministic simulator test control.
            // Deliberately rendered as a dim, secondary debug affordance.
            Button(action: { viewModel.importDebugFixture() }) {
                HStack(spacing: 8) {
                    Text("DEBUG")
                        .font(.system(size: 8, weight: .bold, design: .monospaced))
                        .tracking(1.6)
                        .foregroundStyle(Color.yellow.opacity(0.7))
                    Text("LOAD TEST FIXTURE")
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .tracking(1.2)
                        .foregroundStyle(TethrTheme.fg3)
                    Spacer(minLength: 0)
                    Text("\u{203A}")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(Color.yellow.opacity(0.6))
                }
                .padding(.horizontal, 12)
                .frame(height: 30)
                .frame(maxWidth: .infinity)
                .overlay(
                    Rectangle().stroke(Color.yellow.opacity(0.34),
                                       style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 34)
#endif

            Spacer(minLength: 0)
        }
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else {
                viewModel.cancelImport()
                return
            }
            viewModel.handleImport(result: .success(url))
        case .failure(let error):
            viewModel.handleImport(result: .failure(error))
        }
    }
}

// MARK: - Screen stubs (will be replaced by real screens in tasks #5–#10)

private struct TethrLaunchScreenStub: View {
    let onDone: () -> Void

    var body: some View {
        ZStack {
            TethrTheme.bg0
            VStack(spacing: 24) {
                TethrWordmark(size: 96)
                Text("LAUNCHING")
                    .font(TethrFont.medium(10))
                    .tracking(10 * 0.4)
                    .foregroundStyle(TethrTheme.fg3)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onDone)
        .task {
            try? await Task.sleep(nanoseconds: 1_400_000_000)
            onDone()
        }
    }
}

private struct TethrAnalyzingScreenStub: View {
    var body: some View {
        ZStack {
            TethrTheme.bg0
            VStack(spacing: 18) {
                Text("ANALYZING")
                    .font(TethrFont.bold(24))
                    .tracking(24 * 0.14)
                    .foregroundStyle(TethrTheme.fg0)
                Text("READING TAKES · DETECTING BPM · MAPPING DRIFT")
                    .font(TethrFont.medium(10))
                    .tracking(10 * 0.26)
                    .foregroundStyle(TethrTheme.fg2)
                ProgressView()
                    .tint(TethrTheme.cyan)
            }
        }
    }
}

private struct TethrExportScreenStub: View {
    let onClose: () -> Void

    var body: some View {
        ZStack {
            TethrTheme.bg0
            VStack(spacing: 12) {
                Text("EXPORT")
                    .font(TethrFont.bold(22))
                    .tracking(22 * 0.14)
                    .foregroundStyle(TethrTheme.fg0)
                Button("BACK", action: onClose)
                    .font(TethrFont.medium(11))
                    .tracking(11 * 0.22)
                    .foregroundStyle(TethrTheme.cyan)
            }
        }
    }
}

private struct TethrWordmark: View {
    let size: CGFloat
    var tagline: Bool = true

    var body: some View {
        VStack(alignment: .leading, spacing: size * 0.1) {
            Text("TETHR")
                .font(TethrFont.display(size))
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
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .fixedSize(horizontal: true, vertical: false)

            if tagline {
                Text("B  Y     N  I  G  H  T  S  H  A  P  E")
                    .font(TethrFont.medium(max(10, size * 0.185)))
                    .kerning(0)
                    .tracking(0)
                    .foregroundStyle(TethrTheme.fg2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                    .fixedSize(horizontal: true, vertical: false)
                    .accessibilityLabel("BY NIGHTSHAPE")
            }
        }
        // -1pt optical shift to compensate for the leading "T" sidebearing,
        // matching the reference's `opticalLeft: -1` on tagline.
        .offset(x: tagline ? -1 : 0)
        .accessibilityElement(children: .combine)
    }
}

private struct TethrBpmReadout: View {
    @ObservedObject var viewModel: TethrEditorViewModel
    @State private var dragBaseBpm: Int?
    @State private var isEditing = false
    @State private var draftBpm = ""
    @FocusState private var isFieldFocused: Bool

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            Text("BPM")
                .font(TethrFont.light(9))
                .tracking(2.4)
                .foregroundStyle(TethrTheme.textLow.opacity(0.78))

            Group {
                if isEditing {
                    TextField("", text: $draftBpm)
                        .font(TethrFont.bold(38))
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .focused($isFieldFocused)
                        .foregroundStyle(TethrTheme.text)
                        .frame(width: 88, height: 46, alignment: .trailing)
                        .onChange(of: draftBpm) { _, newValue in
                            filterAndApplyDraft(newValue)
                        }
                        .onChange(of: isFieldFocused) { _, focused in
                            if !focused { isEditing = false }
                        }
                } else {
                    Text(viewModel.project.bpmText)
                        .font(TethrFont.bold(40))
                        .foregroundStyle(TethrTheme.text)
                        .frame(width: 88, height: 46, alignment: .trailing)
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2, perform: beginEditing)
                        .gesture(
                            DragGesture(minimumDistance: 2)
                                .onChanged { value in
                                    if dragBaseBpm == nil {
                                        dragBaseBpm = viewModel.currentMasterBpm
                                    }

                                    if let dragBaseBpm {
                                        viewModel.adjustMasterBpm(
                                            from: dragBaseBpm,
                                            verticalTranslation: Double(value.translation.height)
                                        )
                                    }
                                }
                                .onEnded { _ in
                                    dragBaseBpm = nil
                                }
                        )
                }
            }

            Button("TAP", action: viewModel.registerTapTempo)
                .buttonStyle(TethrSignalButtonStyle(tone: .indigo))
                .frame(width: 88)
        }
    }

    private func beginEditing() {
        draftBpm = "\(viewModel.currentMasterBpm)"
        isEditing = true
        isFieldFocused = true
    }

    private func filterAndApplyDraft(_ newValue: String) {
        let filtered = String(newValue.filter(\.isNumber))
        if filtered != newValue {
            draftBpm = filtered
            return
        }

        guard let bpm = Int(filtered) else { return }
        viewModel.setMasterBpm(bpm)
    }
}

private struct TethrImportTargetCard: View {
    let title: String
    let subtitle: String
    let isLoaded: Bool
    let tone: TethrSignalTone
    let action: () -> Void

    private var accent: Color {
        TethrTheme.color(for: tone)
    }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(TethrFont.bold(13))
                    .tracking(2.2)
                    .foregroundStyle(isLoaded ? accent : TethrTheme.textMid)

                Text(subtitle)
                    .font(TethrFont.light(10))
                    .tracking(1.5)
                    .lineLimit(1)
                    .minimumScaleFactor(0.62)
                    .foregroundStyle(isLoaded ? TethrTheme.text : TethrTheme.textLow.opacity(0.70))
            }
            .frame(maxWidth: .infinity, minHeight: 84, alignment: .leading)
            .padding(14)
            .background(TethrTheme.panel.opacity(isLoaded ? 1 : 0.92))
            .overlay(
                Rectangle()
                    .stroke(isLoaded ? accent.opacity(0.56) : TethrTheme.border, lineWidth: 1)
            )
            .overlay(TethrCornerCaps(color: TethrTheme.cyan))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(subtitle)")
    }
}

private struct TethrEmptyImportPanel: View {
    let action: () -> Void
    var isLandscape: Bool = false

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                // Card index / status marks — NIGHTSHAPE creation-path grammar.
                HStack(alignment: .top) {
                    Text("01")
                        .font(TethrFont.medium(11))
                        .tracking(0.8)
                        .foregroundStyle(TethrTheme.fg3.opacity(0.76))
                    Spacer()
                    Text("\u{2022}\u{2022}\u{2022}")
                        .font(TethrFont.medium(11))
                        .tracking(1.4)
                        .foregroundStyle(TethrTheme.fg3.opacity(0.5))
                }
                .padding(.bottom, 22)

                VStack(alignment: .leading, spacing: 16) {
                    Text("IMPORT AUDIO")
                        .font(TethrFont.bold(15))
                        .tracking(2.0)
                        .foregroundStyle(TethrTheme.fg0)

                    Text("Load one song to auto-correct. Add a second take later only if section swaps are needed.")
                        .font(TethrFont.light(12))
                        .tracking(12 * 0.055)
                        .lineSpacing(12 * 0.72)
                        .textCase(.uppercase)
                        .foregroundStyle(TethrTheme.fg2.opacity(0.9))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 480, alignment: .leading)
                }

                Spacer(minLength: 24)

                Text("WAV  \u{00B7}  MP3  \u{00B7}  M4A  \u{00B7}  AIFF  \u{00B7}  FLAC")
                    .font(TethrFont.medium(10))
                    .tracking(10 * 0.16)
                    .foregroundStyle(TethrTheme.fg4)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                    .padding(.bottom, 16)

                TethrActionControl(label: "Select file", accent: TethrTheme.cyan)
            }
            .frame(
                maxWidth: .infinity,
                minHeight: isLandscape ? 230 : 334,
                maxHeight: isLandscape ? 230 : 334,
                alignment: .topLeading
            )
            .padding(.horizontal, isLandscape ? 40 : 30)
            .padding(.top, 26)
            .padding(.bottom, 22)
            .background(Color(red: 11 / 255, green: 11 / 255, blue: 14 / 255).opacity(0.48))
            .overlay(
                Rectangle()
                    .stroke(
                        TethrTheme.fg3.opacity(0.2),
                        style: StrokeStyle(lineWidth: 1, dash: [6, 7])
                    )
            )
            .overlay(TethrCornerMarks(color: TethrTheme.cyan, opacity: 0.5, length: 16))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Import audio. Load one song to auto-correct. Add a second take later only if section swaps are needed.")
    }
}

struct TethrOrientationLockButton: View {
    @ObservedObject var manager: OrientationLockManager

    var body: some View {
        Button(action: manager.cycle) {
            TethrRotateIcon()
                .frame(width: 25, height: 25)
                .rotationEffect(manager.lock == .landscape ? .degrees(90) : .zero)
                .frame(width: 28, height: 32, alignment: .trailing)
                .foregroundStyle(manager.lock.isLocked ? TethrTheme.cyan : TethrTheme.fg3)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        switch manager.lock {
        case .auto: return "Orientation: auto. Tap to lock portrait."
        case .portrait: return "Orientation: portrait locked. Tap to lock landscape."
        case .landscape: return "Orientation: landscape locked. Tap for auto."
        }
    }
}

private struct TethrRotateIcon: View {
    var body: some View {
        Canvas { ctx, size in
            let scale = size.width / 24
            let strokeWidth = 1.5 * scale

            // Portrait rect on the left
            let rect = CGRect(
                x: 4 * scale,
                y: 3 * scale,
                width: 9 * scale,
                height: 14 * scale
            )
            let rectPath = Path(roundedRect: rect, cornerRadius: 1 * scale)
            ctx.stroke(rectPath, with: .color(.primary), lineWidth: strokeWidth)

            // Curved arrow arc on the right
            var arc = Path()
            arc.move(to: CGPoint(x: 16 * scale, y: 9 * scale))
            arc.addQuadCurve(
                to: CGPoint(x: 20 * scale, y: 17 * scale),
                control: CGPoint(x: 23 * scale, y: 11 * scale)
            )
            ctx.stroke(arc, with: .color(.primary), lineWidth: strokeWidth)

            // Arrowhead — small polyline at end of arc
            var head = Path()
            head.move(to: CGPoint(x: 20 * scale, y: 13 * scale))
            head.addLine(to: CGPoint(x: 20 * scale, y: 18 * scale))
            head.addLine(to: CGPoint(x: 15 * scale, y: 18 * scale))
            ctx.stroke(head, with: .color(.primary), lineWidth: strokeWidth)
        }
    }
}

private struct TethrCornerCaps: View {
    let color: Color
    private let length: CGFloat = 30
    private let thickness: CGFloat = 2

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                cap(rotation: .degrees(0))
                    .position(x: length / 2, y: length / 2)

                cap(rotation: .degrees(90))
                    .position(x: geometry.size.width - length / 2, y: length / 2)

                cap(rotation: .degrees(270))
                    .position(x: length / 2, y: geometry.size.height - length / 2)

                cap(rotation: .degrees(180))
                    .position(x: geometry.size.width - length / 2, y: geometry.size.height - length / 2)
            }
        }
        .allowsHitTesting(false)
    }

    private func cap(rotation: Angle) -> some View {
        ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(color)
                .frame(width: length, height: thickness)

            Rectangle()
                .fill(color)
                .frame(width: thickness, height: length)
        }
        .frame(width: length, height: length)
        .rotationEffect(rotation)
    }
}

#Preview {
    TethrRootView()
        .environmentObject(OrientationLockManager.shared)
}
