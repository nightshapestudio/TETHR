import Foundation

enum TethrCompositePlanError: Error, Equatable {
    case missingSharedSegmentMap
    case missingSelection(segmentID: TethrSharedSegment.ID)
    case missingSource(sourceID: TethrSourceTrack.ID)
}

protocol TethrCompositePlanning {
    func makePlan(from composition: TethrCompositionState) throws -> TethrCompositePlan
}

struct TethrCompositePlanner: TethrCompositePlanning {
    func makePlan(from composition: TethrCompositionState) throws -> TethrCompositePlan {
        guard let segmentMap = composition.sharedSegmentMap else {
            throw TethrCompositePlanError.missingSharedSegmentMap
        }

        let slices = try segmentMap.segments.map { segment in
            guard let activeSourceID = composition.activeSourceID(for: segment.id) else {
                throw TethrCompositePlanError.missingSelection(segmentID: segment.id)
            }
            guard composition.source(id: activeSourceID) != nil else {
                throw TethrCompositePlanError.missingSource(sourceID: activeSourceID)
            }

            return TethrCompositeSlice(
                segmentID: segment.id,
                sourceID: activeSourceID,
                targetStartTime: segment.startTime,
                sourceStartTime: segment.startTime,
                duration: segment.duration
            )
        }

        return TethrCompositePlan(
            slices: slices,
            duration: segmentMap.segments.last?.endTime ?? 0
        )
    }
}
