import Foundation

enum TethrSourceSlot: String, CaseIterable, Identifiable, Equatable {
    case primary
    case alternate

    var id: String { rawValue }
}

struct TethrSourceTrack: Identifiable, Equatable {
    let id: UUID
    var slot: TethrSourceSlot
    var fileName: String
    var duration: TimeInterval
    var originalURL: URL?
    var detectedBpm: Double?
    var bpmConfidence: Double?

    init(
        id: UUID = UUID(),
        slot: TethrSourceSlot,
        fileName: String,
        duration: TimeInterval,
        originalURL: URL? = nil,
        detectedBpm: Double? = nil,
        bpmConfidence: Double? = nil
    ) {
        self.id = id
        self.slot = slot
        self.fileName = fileName
        self.duration = duration
        self.originalURL = originalURL
        self.detectedBpm = detectedBpm
        self.bpmConfidence = bpmConfidence
    }
}

struct TethrBeatMarker: Identifiable, Equatable {
    let id: UUID
    var beatIndex: Int
    var detectedTime: TimeInterval
    var confidence: Double

    init(
        id: UUID = UUID(),
        beatIndex: Int,
        detectedTime: TimeInterval,
        confidence: Double
    ) {
        self.id = id
        self.beatIndex = beatIndex
        self.detectedTime = detectedTime
        self.confidence = confidence
    }
}

// MARK: - Diff 1: barStart / barEnd / displayLabel / barRangeDisplay

struct TethrSharedSegment: Identifiable, Equatable {
    let id: UUID
    var index: Int
    var startTime: TimeInterval
    var duration: TimeInterval
    var label: String
    var barStart: Int?       // first bar of this segment (1-based), nil if grid unknown
    var barEnd: Int?         // last bar of this segment (inclusive), nil if grid unknown

    init(
        id: UUID = UUID(),
        index: Int,
        startTime: TimeInterval,
        duration: TimeInterval,
        label: String,
        barStart: Int? = nil,
        barEnd: Int? = nil
    ) {
        self.id = id
        self.index = index
        self.startTime = startTime
        self.duration = duration
        self.label = label
        self.barStart = barStart
        self.barEnd = barEnd
    }

    var endTime: TimeInterval {
        startTime + duration
    }

    /// Always returns neutral NIGHTSHAPE label regardless of stored `label` value.
    /// Use this in all UI. Do not use `label` directly in views.
    var displayLabel: String {
        String(format: "SEGMENT %02d", index)
    }

    /// Returns bar range string if grid data is available, e.g. "BARS 001–009"
    var barRangeDisplay: String? {
        guard let s = barStart, let e = barEnd else { return nil }
        return String(format: "BARS %03d–%03d", s, e)
    }
}

// MARK: - Diff 2: beatsPerBar / barDuration

struct TethrSharedSegmentMap: Equatable {
    let id: UUID
    var sourceIDs: [TethrSourceTrack.ID]
    var segments: [TethrSharedSegment]
    var beatMarkers: [TethrBeatMarker]
    var detectedBpm: Double?
    var confidence: Double
    var beatsPerBar: Int     // always 4 unless time-signature detection is added later

    init(
        id: UUID = UUID(),
        sourceIDs: [TethrSourceTrack.ID],
        segments: [TethrSharedSegment],
        beatMarkers: [TethrBeatMarker] = [],
        detectedBpm: Double? = nil,
        confidence: Double = 0,
        beatsPerBar: Int = 4
    ) {
        self.id = id
        self.sourceIDs = sourceIDs
        self.segments = segments
        self.beatMarkers = beatMarkers
        self.detectedBpm = detectedBpm
        self.confidence = confidence
        self.beatsPerBar = beatsPerBar
    }

    /// Duration of one bar in seconds. Nil if BPM is unknown.
    var barDuration: TimeInterval? {
        guard let bpm = detectedBpm, bpm > 0 else { return nil }
        return (60.0 / bpm) * Double(beatsPerBar)
    }
}

struct TethrSegmentSelection: Identifiable, Equatable {
    var id: TethrSharedSegment.ID { segmentID }
    let segmentID: TethrSharedSegment.ID
    var activeSourceID: TethrSourceTrack.ID
}

struct TethrCompositeSlice: Identifiable, Equatable {
    let id: UUID
    var segmentID: TethrSharedSegment.ID
    var sourceID: TethrSourceTrack.ID
    var targetStartTime: TimeInterval
    var sourceStartTime: TimeInterval
    var duration: TimeInterval

    init(
        id: UUID = UUID(),
        segmentID: TethrSharedSegment.ID,
        sourceID: TethrSourceTrack.ID,
        targetStartTime: TimeInterval,
        sourceStartTime: TimeInterval,
        duration: TimeInterval
    ) {
        self.id = id
        self.segmentID = segmentID
        self.sourceID = sourceID
        self.targetStartTime = targetStartTime
        self.sourceStartTime = sourceStartTime
        self.duration = duration
    }
}

struct TethrCompositePlan: Equatable {
    var slices: [TethrCompositeSlice]
    var duration: TimeInterval

    static let empty = TethrCompositePlan(slices: [], duration: 0)
}

struct TethrCompositionState: Equatable {
    var sources: [TethrSourceTrack] = []
    var sharedSegmentMap: TethrSharedSegmentMap?
    var selectionsBySegmentID: [TethrSharedSegment.ID: TethrSourceTrack.ID] = [:]
    var compositePlan: TethrCompositePlan = .empty

    var canAnalyzeSharedSegments: Bool {
        !sources.isEmpty
    }

    var selectedSegments: [TethrSegmentSelection] {
        selectionsBySegmentID.map { segmentID, sourceID in
            TethrSegmentSelection(segmentID: segmentID, activeSourceID: sourceID)
        }
        .sorted { lhs, rhs in
            let lhsIndex = sharedSegmentMap?.segments.first(where: { $0.id == lhs.segmentID })?.index ?? 0
            let rhsIndex = sharedSegmentMap?.segments.first(where: { $0.id == rhs.segmentID })?.index ?? 0
            return lhsIndex < rhsIndex
        }
    }

    func source(in slot: TethrSourceSlot) -> TethrSourceTrack? {
        sources.first { $0.slot == slot }
    }

    func source(id: TethrSourceTrack.ID) -> TethrSourceTrack? {
        sources.first { $0.id == id }
    }

    func activeSourceID(for segmentID: TethrSharedSegment.ID) -> TethrSourceTrack.ID? {
        selectionsBySegmentID[segmentID]
    }

    mutating func upsertSource(_ source: TethrSourceTrack) {
        if let existingIndex = sources.firstIndex(where: { $0.slot == source.slot }) {
            let previousID = sources[existingIndex].id
            sources[existingIndex] = source
            replaceSelectionSource(previousID, with: source.id)
        } else {
            sources.append(source)
        }

        if sharedSegmentMap?.sourceIDs.contains(source.id) == false {
            clearSharedAnalysis()
        }
    }

    mutating func applySharedSegmentMap(_ segmentMap: TethrSharedSegmentMap, defaultSourceID: TethrSourceTrack.ID? = nil) {
        sharedSegmentMap = segmentMap
        let fallbackSourceID = defaultSourceID ?? source(in: .primary)?.id ?? sources.first?.id
        selectionsBySegmentID = Dictionary(
            uniqueKeysWithValues: segmentMap.segments.compactMap { segment in
                guard let fallbackSourceID else { return nil }
                return (segment.id, fallbackSourceID)
            }
        )
        compositePlan = .empty
    }

    mutating func selectSource(_ sourceID: TethrSourceTrack.ID, for segmentID: TethrSharedSegment.ID) {
        guard source(id: sourceID) != nil else { return }
        guard sharedSegmentMap?.segments.contains(where: { $0.id == segmentID }) == true else { return }
        selectionsBySegmentID[segmentID] = sourceID
    }

    mutating func updateCompositePlan(_ plan: TethrCompositePlan) {
        compositePlan = plan
    }

    mutating func clearSharedAnalysis() {
        sharedSegmentMap = nil
        selectionsBySegmentID = [:]
        compositePlan = .empty
    }

    private mutating func replaceSelectionSource(_ previousID: TethrSourceTrack.ID, with newID: TethrSourceTrack.ID) {
        for (segmentID, sourceID) in selectionsBySegmentID where sourceID == previousID {
            selectionsBySegmentID[segmentID] = newID
        }
    }
}

// MARK: - Persistence

/// Single source of truth for on-disk locations. The imports directory holds the
/// sandbox-copied audio; the composition file holds the restorable snapshot.
enum TethrStorage {
    static var documentsDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    static var importsDirectory: URL {
        documentsDirectory.appendingPathComponent("TETHR Imports", isDirectory: true)
    }

    static var exportsDirectory: URL {
        documentsDirectory.appendingPathComponent("TETHR Exports", isDirectory: true)
    }

    static var compositionFile: URL {
        documentsDirectory.appendingPathComponent("tethr-composition.json")
    }
}

/// Codable snapshot of a composition. Sources are stored by their *relative*
/// sandbox filename (not absolute or security-scoped URLs), because the iOS app
/// container path changes between launches/reinstalls — absolute paths are stale.
struct TethrCompositionSnapshot: Codable {
    struct Source: Codable {
        var id: UUID
        var slot: String
        var fileName: String
        var sandboxFileName: String
        var duration: TimeInterval
        var detectedBpm: Double?
        var bpmConfidence: Double?
    }

    // MARK: - Diff 3: barStart / barEnd in Segment snapshot

    struct Segment: Codable {
        var id: UUID
        var index: Int
        var startTime: TimeInterval
        var duration: TimeInterval
        var label: String
        var barStart: Int?   // optional — missing key in old saves decodes as nil
        var barEnd: Int?
    }

    struct BeatMarker: Codable {
        var id: UUID
        var beatIndex: Int
        var detectedTime: TimeInterval
        var confidence: Double
    }

    var version = 1
    var sources: [Source]
    var segments: [Segment]
    var beatMarkers: [BeatMarker]
    var segmentDetectedBpm: Double?
    var segmentConfidence: Double
    // MARK: - Diff 6: beatsPerBar in snapshot (optional so old saves decode as nil → default 4)
    var segmentBeatsPerBar: Int?
    var selections: [String: UUID] // segmentID.uuidString -> sourceID
    var masterBpm: Int?
    var isMasterBpmManual: Bool
    var bpmConfidence: Double?
    var sourceName: String?
    var sourceDuration: TimeInterval?
    var detectedBpm: Double?

    /// Builds a snapshot from live state. Returns nil when there is nothing
    /// worth persisting (no primary source with a sandbox file).
    init?(project: TethrProject, composition: TethrCompositionState) {
        guard composition.source(in: .primary)?.originalURL != nil else { return nil }

        sources = composition.sources.compactMap { source in
            guard let url = source.originalURL else { return nil }
            return Source(
                id: source.id,
                slot: source.slot.rawValue,
                fileName: source.fileName,
                sandboxFileName: url.lastPathComponent,
                duration: source.duration,
                detectedBpm: source.detectedBpm,
                bpmConfidence: source.bpmConfidence
            )
        }
        guard !sources.isEmpty else { return nil }

        let map = composition.sharedSegmentMap
        // MARK: - Diff 4: include barStart / barEnd in snapshot init
        segments = map?.segments.map {
            Segment(
                id: $0.id,
                index: $0.index,
                startTime: $0.startTime,
                duration: $0.duration,
                label: $0.label,
                barStart: $0.barStart,
                barEnd: $0.barEnd
            )
        } ?? []
        beatMarkers = map?.beatMarkers.map {
            BeatMarker(id: $0.id, beatIndex: $0.beatIndex, detectedTime: $0.detectedTime, confidence: $0.confidence)
        } ?? []
        segmentDetectedBpm = map?.detectedBpm
        segmentConfidence = map?.confidence ?? 0
        segmentBeatsPerBar = map?.beatsPerBar   // Diff 6
        selections = Dictionary(uniqueKeysWithValues: composition.selectionsBySegmentID.map { ($0.key.uuidString, $0.value) })

        masterBpm = project.masterBpm
        isMasterBpmManual = project.isMasterBpmManual
        bpmConfidence = project.bpmConfidence
        sourceName = project.sourceName
        sourceDuration = project.sourceDuration
        detectedBpm = project.detectedBpm
    }

    /// Rebuilds live state, verifying every sandbox file still exists. Returns
    /// nil if any source file is missing (caller should fall back to empty).
    func restoredState() -> (project: TethrProject, composition: TethrCompositionState)? {
        var tracks: [TethrSourceTrack] = []
        for source in sources {
            let url = TethrStorage.importsDirectory.appendingPathComponent(source.sandboxFileName)
            guard FileManager.default.fileExists(atPath: url.path),
                  let slot = TethrSourceSlot(rawValue: source.slot) else { return nil }
            tracks.append(
                TethrSourceTrack(
                    id: source.id,
                    slot: slot,
                    fileName: source.fileName,
                    duration: source.duration,
                    originalURL: url,
                    detectedBpm: source.detectedBpm,
                    bpmConfidence: source.bpmConfidence
                )
            )
        }
        guard !tracks.isEmpty else { return nil }

        var composition = TethrCompositionState()
        composition.sources = tracks

        // MARK: - Diff 5: thread barStart / barEnd through restore
        let restoredSegments = segments.map {
            TethrSharedSegment(
                id: $0.id,
                index: $0.index,
                startTime: $0.startTime,
                duration: $0.duration,
                label: $0.label,
                barStart: $0.barStart,
                barEnd: $0.barEnd
            )
        }
        if !restoredSegments.isEmpty {
            // Diff 6: restore beatsPerBar, fall back to 4 for old saves
            composition.sharedSegmentMap = TethrSharedSegmentMap(
                sourceIDs: tracks.map(\.id),
                segments: restoredSegments,
                beatMarkers: beatMarkers.map {
                    TethrBeatMarker(id: $0.id, beatIndex: $0.beatIndex, detectedTime: $0.detectedTime, confidence: $0.confidence)
                },
                detectedBpm: segmentDetectedBpm,
                confidence: segmentConfidence,
                beatsPerBar: segmentBeatsPerBar ?? 4
            )
            var restoredSelections: [TethrSharedSegment.ID: TethrSourceTrack.ID] = [:]
            for (key, sourceID) in selections {
                guard let segmentID = UUID(uuidString: key),
                      restoredSegments.contains(where: { $0.id == segmentID }),
                      tracks.contains(where: { $0.id == sourceID }) else { continue }
                restoredSelections[segmentID] = sourceID
            }
            composition.selectionsBySegmentID = restoredSelections
        }

        var project = TethrProject()
        project.sourceName = sourceName
        project.sourceDuration = sourceDuration
        project.detectedBpm = detectedBpm
        project.masterBpm = masterBpm
        project.isMasterBpmManual = isMasterBpmManual
        project.bpmConfidence = bpmConfidence
        project.importState = .loaded
        project.correctionState = restoredSegments.isEmpty ? .conservative : .ready
        project.segmentCount = restoredSegments.count

        return (project, composition)
    }
}

/// Reads/writes the composition snapshot as JSON in the app sandbox.
enum TethrCompositionStore {
    static func save(_ snapshot: TethrCompositionSnapshot?) {
        guard let snapshot else {
            clear()
            return
        }
        do {
            let data = try JSONEncoder().encode(snapshot)
            try data.write(to: TethrStorage.compositionFile, options: .atomic)
        } catch {
            // Persistence is best-effort; a failed write must never break the app.
        }
    }

    static func load() -> TethrCompositionSnapshot? {
        guard let data = try? Data(contentsOf: TethrStorage.compositionFile) else { return nil }
        return try? JSONDecoder().decode(TethrCompositionSnapshot.self, from: data)
    }

    static func clear() {
        try? FileManager.default.removeItem(at: TethrStorage.compositionFile)
    }
}
