import Foundation
import os

enum AppScreen: Equatable {
    case launch
    case empty
    case analyzing
    case composite
    case export
}

enum TethrExportState: Equatable {
    case idle
    case exporting
    case success(fileName: String)
    case failure(message: String)
}

@MainActor
final class TethrEditorViewModel: ObservableObject {
    @Published private(set) var appScreen: AppScreen = .launch
    @Published private(set) var project = TethrProject()
    @Published private(set) var composition = TethrCompositionState()
    @Published private(set) var playheadProgress: Double = 0
    @Published private(set) var isPlaying = false
    @Published var isImportPresented = false
    @Published var importErrorMessage: String?
    @Published var exportState: TethrExportState = .idle

    private static let logger = Logger(subsystem: "com.nightshape.tethr", category: "import")
    private let bpmRange = 60...200
    private let audioEngine: TethrAudioEngineProtocol
    private let sharedSegmentPipeline: TethrSharedSegmentAnalysisPipeline
    private let compositePlanner: TethrCompositePlanning
    private var pendingImportSlot: TethrSourceSlot = .primary
    private var tapTempoHistory: [Date] = []
    private var playbackTask: Task<Void, Never>?

    init(
        audioEngine: TethrAudioEngineProtocol = TethrAudioEngine(),
        sharedSegmentPipeline: TethrSharedSegmentAnalysisPipeline = TethrSharedSegmentAnalysisPipeline(),
        compositePlanner: TethrCompositePlanning = TethrCompositePlanner()
    ) {
        self.audioEngine = audioEngine
        self.sharedSegmentPipeline = sharedSegmentPipeline
        self.compositePlanner = compositePlanner

        restorePersistedComposition()
    }

    /// Restores a saved composition on launch. If the snapshot is missing,
    /// undecodable, or references a sandbox file that no longer exists, the
    /// stale snapshot is cleared and the app starts in its normal empty state.
    private func restorePersistedComposition() {
        guard let snapshot = TethrCompositionStore.load() else { return }
        guard let restored = snapshot.restoredState() else {
            TethrCompositionStore.clear()
            return
        }
        project = restored.project
        composition = restored.composition
        appScreen = .composite
    }

    private func persistComposition() {
        TethrCompositionStore.save(TethrCompositionSnapshot(project: project, composition: composition))
    }

    var sourceTitle: String {
        project.sourceName ?? "No source"
    }

    var currentMasterBpm: Int {
        project.masterBpm ?? project.detectedBpm.map { Int($0.rounded()) } ?? 128
    }

    var waveformBeatMarkers: [TethrBeatMarker] {
        composition.sharedSegmentMap?.beatMarkers ?? []
    }

    var telemetryItems: [TethrTelemetryItem] {
        [
            TethrTelemetryItem(
                id: "source",
                label: "Source",
                value: project.importState.rawValue,
                detail: project.sourceName ?? "Waiting",
                tone: project.hasSource ? .cyan : .muted
            ),
            TethrTelemetryItem(
                id: "bpm",
                label: "BPM",
                value: project.bpmText,
                detail: project.confidenceText,
                tone: project.masterBpm == nil && project.detectedBpm == nil ? .muted : .indigo
            ),
            TethrTelemetryItem(
                id: "correction",
                label: "Correction",
                value: project.correctionState.rawValue,
                detail: project.hasSource ? "Queued" : "Standby",
                tone: project.hasSource ? .purple : .muted
            ),
            TethrTelemetryItem(
                id: "structure",
                label: "Structure",
                value: project.segmentCount == 0 ? "--" : "\(project.segmentCount)",
                detail: project.segmentCount == 0 ? "No segments" : "Segments",
                tone: project.segmentCount == 0 ? .muted : .indigo
            )
        ]
    }

    // MARK: - Screen transitions

    func advanceFromLaunch() {
        guard appScreen == .launch else { return }
        appScreen = .empty
    }

    func returnToEmpty() {
        composition = TethrCompositionState()
        project = TethrProject()
        playheadProgress = 0
        isPlaying = false
        stopPlayheadUpdates()
        appScreen = .empty
        TethrCompositionStore.clear()
    }

    func presentExport() {
        guard appScreen == .composite else { return }
        appScreen = .export
    }

    func dismissExport() {
        guard appScreen == .export else { return }
        appScreen = .composite
    }

    // MARK: - Import

    func presentImport(slot: TethrSourceSlot = .primary) {
        pendingImportSlot = slot
        isImportPresented = true
    }

    func cancelImport() {
        isImportPresented = false
    }

#if DEBUG
    // DEBUG-IMPORT-FIXTURE: Imports a deterministic local fixture through the
    // exact same path as a picker selection. Remove with the fixture feature.
    func importDebugFixture(slot: TethrSourceSlot = .primary) {
        pendingImportSlot = slot
        do {
            let url = try TethrDebugFixture.resolveOrCreate()
            handleImport(result: .success(url))
        } catch {
            let message = (error as? LocalizedError)?.errorDescription
                ?? error.localizedDescription
            importErrorMessage = message
            project.importState = .failed
        }
    }
#endif

    func handleImport(result: Result<URL, Error>) {
        isImportPresented = false

        switch result {
        case .success(let url):
            let importSlot = pendingImportSlot
            importErrorMessage = nil
            project.importState = .reading
            if importSlot == .primary || project.sourceName == nil {
                project.sourceName = url.lastPathComponent
                project.sourceDuration = nil
                project.detectedBpm = nil
                project.masterBpm = nil
                project.isMasterBpmManual = false
                project.bpmConfidence = nil
            }
            project.correctionState = .analyzing
            project.segmentCount = 0
            playheadProgress = 0
            isPlaying = false

            if appScreen == .launch || appScreen == .empty {
                appScreen = .analyzing
            }

            Task {
                do {
                    let summary = try await audioEngine.importSource(at: url)
                    registerSource(summary, url: url, slot: importSlot)
                    if importSlot == .primary || project.sourceName == nil {
                        project.sourceName = summary.fileName
                        project.sourceDuration = summary.duration
                        project.detectedBpm = summary.tempoEstimate?.bpm
                        project.bpmConfidence = summary.tempoEstimate?.confidence
                        if project.masterBpm == nil, let detectedBpm = summary.tempoEstimate?.bpm {
                            project.masterBpm = clampedBpm(Int(detectedBpm.rounded()))
                            project.isMasterBpmManual = false
                        }
                    }
                    project.importState = .loaded
                    project.correctionState = .conservative
                    persistComposition()
                } catch {
                    let message = (error as? LocalizedError)?.errorDescription
                        ?? error.localizedDescription
                    Self.logger.error("Import failed for \(url.lastPathComponent, privacy: .public): \(message, privacy: .public)")
                    importErrorMessage = message
                    project.importState = .failed
                    project.correctionState = .standby
                    if importSlot == .primary || project.sourceName == nil {
                        project.sourceDuration = nil
                    }
                    if appScreen == .analyzing {
                        appScreen = .empty
                    }
                }
            }
        case .failure(let error):
            let message = (error as? LocalizedError)?.errorDescription
                ?? error.localizedDescription
            Self.logger.error("File picker failed: \(message, privacy: .public)")
            importErrorMessage = message
            project.importState = .failed
            project.correctionState = .standby
        }
    }

    func setMasterBpm(_ bpm: Int) {
        project.masterBpm = clampedBpm(bpm)
        project.isMasterBpmManual = true

        if project.hasSource {
            project.correctionState = .ready
            if isPlaying {
                audioEngine.setPlaybackRate(currentPlaybackRate)
            }
            refreshCompositePlan()
            persistComposition()
        }
    }

    func adjustMasterBpm(from baseBpm: Int, verticalTranslation: Double) {
        let delta = Int((-verticalTranslation / 8).rounded())
        setMasterBpm(baseBpm + delta)
    }

    func registerTapTempo() {
        let now = Date()
        tapTempoHistory = tapTempoHistory.filter { now.timeIntervalSince($0) <= 2.2 }
        tapTempoHistory.append(now)

        guard tapTempoHistory.count >= 2 else { return }

        let intervals = zip(tapTempoHistory.dropFirst(), tapTempoHistory).map { current, previous in
            current.timeIntervalSince(previous)
        }
        let averageInterval = intervals.reduce(0, +) / Double(intervals.count)
        guard averageInterval > 0 else { return }

        setMasterBpm(Int((60 / averageInterval).rounded()))
        project.bpmConfidence = max(project.bpmConfidence ?? 0, 0.82)
    }

    func togglePlayback() {
        guard let source = composition.source(in: .primary) ?? composition.sources.first,
              let playableURL = source.originalURL else {
            presentImport()
            return
        }

        if isPlaying {
            audioEngine.pausePlayback()
            isPlaying = false
            stopPlayheadUpdates()
            return
        }

        do {
            try audioEngine.playSource(
                at: playableURL,
                from: playheadProgress,
                rate: currentPlaybackRate
            )
            isPlaying = true
            startPlayheadUpdates(duration: source.duration)
        } catch {
            isPlaying = false
            stopPlayheadUpdates()
            project.correctionState = .conservative
        }
    }

    func resetPlayhead() {
        audioEngine.stopPlayback()
        stopPlayheadUpdates()
        isPlaying = false
        playheadProgress = 0
    }

    func registerSource(_ summary: TethrSourceSummary, url: URL?, slot: TethrSourceSlot) {
        let source = TethrSourceTrack(
            slot: slot,
            fileName: summary.fileName,
            duration: summary.duration,
            originalURL: summary.playableURL,
            detectedBpm: summary.tempoEstimate?.bpm,
            bpmConfidence: summary.tempoEstimate?.confidence
        )
        composition.upsertSource(source)
        project.segmentCount = composition.sharedSegmentMap?.segments.count ?? 0

        Task {
            await analyzeSharedSegmentsIfReady()
        }
    }

    func selectSource(_ sourceID: TethrSourceTrack.ID, for segmentID: TethrSharedSegment.ID) {
        composition.selectSource(sourceID, for: segmentID)
        refreshCompositePlan()
        persistComposition()
    }

    // MARK: - Export

    /// Renders the current TAKE A/B routing into a single WAV in the sandbox.
    func exportComposite() {
        guard exportState != .exporting else { return }

        guard let map = composition.sharedSegmentMap, !map.segments.isEmpty,
              let primary = composition.source(in: .primary) ?? composition.sources.first,
              let referenceURL = primary.originalURL else {
            exportState = .failure(message: TethrExportError.nothingToExport.errorDescription ?? "Nothing to export")
            return
        }

        // Build a Sendable render plan on the main actor (selected source per
        // segment, in timeline order) so rendering can run off-main.
        let plan: [TethrExportSegment] = map.segments
            .sorted { $0.index < $1.index }
            .map { segment in
                let sourceID = composition.activeSourceID(for: segment.id) ?? primary.id
                let url = (composition.source(id: sourceID) ?? primary).originalURL ?? referenceURL
                return TethrExportSegment(sourceURL: url, startTime: segment.startTime, duration: segment.duration)
            }

        exportState = .exporting
        Task {
            do {
                let outURL = try await Task.detached(priority: .userInitiated) {
                    try TethrCompositeExporter().export(segments: plan, referenceURL: referenceURL)
                }.value
                exportState = .success(fileName: outURL.lastPathComponent)
            } catch {
                let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                exportState = .failure(message: message)
            }
        }
    }

    private func analyzeSharedSegmentsIfReady() async {
        do {
            guard let segmentMap = try await sharedSegmentPipeline.analyzeIfReady(composition) else {
                refreshCompositePlan()
                return
            }

            composition.applySharedSegmentMap(segmentMap)
            project.segmentCount = segmentMap.segments.count
            project.detectedBpm = segmentMap.detectedBpm
            if project.masterBpm == nil {
                project.masterBpm = segmentMap.detectedBpm.map { clampedBpm(Int($0.rounded())) }
                project.isMasterBpmManual = false
            }
            project.bpmConfidence = segmentMap.confidence
            project.correctionState = .ready
            refreshCompositePlan()
            persistComposition()
            if appScreen == .analyzing {
                appScreen = .composite
            }
        } catch {
            project.correctionState = .conservative
            refreshCompositePlan()
            if appScreen == .analyzing {
                appScreen = .composite
            }
        }
    }

    private func refreshCompositePlan() {
        do {
            let plan = try compositePlanner.makePlan(from: composition)
            composition.updateCompositePlan(plan)
        } catch {
            composition.updateCompositePlan(.empty)
        }
    }

    private func clampedBpm(_ bpm: Int) -> Int {
        min(max(bpm, bpmRange.lowerBound), bpmRange.upperBound)
    }

    private var currentPlaybackRate: Double {
        guard let detectedBpm = project.detectedBpm, detectedBpm > 0 else {
            return 1
        }

        return min(2.0, max(0.5, Double(currentMasterBpm) / detectedBpm))
    }

    private func startPlayheadUpdates(duration: TimeInterval) {
        stopPlayheadUpdates()

        playbackTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 33_000_000)

                await MainActor.run {
                    guard let self else { return }

                    let normalizedDuration = max(duration, 0.001)
                    self.playheadProgress = min(1, max(0, self.audioEngine.currentTime / normalizedDuration))

                    if !self.audioEngine.isPlaybackActive && self.playheadProgress >= 0.995 {
                        self.isPlaying = false
                        self.playheadProgress = 0
                        self.stopPlayheadUpdates()
                    }
                }
            }
        }
    }

    private func stopPlayheadUpdates() {
        playbackTask?.cancel()
        playbackTask = nil
    }
}
