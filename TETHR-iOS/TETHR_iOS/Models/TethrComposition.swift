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

    init(
        id: UUID = UUID(),
        slot: TethrSourceSlot,
        fileName: String,
        duration: TimeInterval,
        originalURL: URL? = nil
    ) {
        self.id = id
        self.slot = slot
        self.fileName = fileName
        self.duration = duration
        self.originalURL = originalURL
    }
}

struct TethrSharedSegment: Identifiable, Equatable {
    let id: UUID
    var index: Int
    var startTime: TimeInterval
    var duration: TimeInterval
    var label: String

    init(
        id: UUID = UUID(),
        index: Int,
        startTime: TimeInterval,
        duration: TimeInterval,
        label: String
    ) {
        self.id = id
        self.index = index
        self.startTime = startTime
        self.duration = duration
        self.label = label
    }

    var endTime: TimeInterval {
        startTime + duration
    }
}

struct TethrSharedSegmentMap: Equatable {
    let id: UUID
    var sourceIDs: [TethrSourceTrack.ID]
    var segments: [TethrSharedSegment]
    var detectedBpm: Double?
    var confidence: Double

    init(
        id: UUID = UUID(),
        sourceIDs: [TethrSourceTrack.ID],
        segments: [TethrSharedSegment],
        detectedBpm: Double? = nil,
        confidence: Double = 0
    ) {
        self.id = id
        self.sourceIDs = sourceIDs
        self.segments = segments
        self.detectedBpm = detectedBpm
        self.confidence = confidence
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
        sources.count >= 2
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
