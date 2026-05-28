import Foundation

enum TethrSharedSegmentAnalysisError: Error, Equatable {
    case insufficientSources
    case missingUsableDuration
}

protocol TethrSharedSegmentAnalyzing {
    func analyzeSharedSegments(for sources: [TethrSourceTrack]) async throws -> TethrSharedSegmentMap
}

struct TethrSharedSegmentAnalysisPipeline {
    var analyzer: TethrSharedSegmentAnalyzing

    init(analyzer: TethrSharedSegmentAnalyzing = TethrPlaceholderSharedSegmentAnalyzer()) {
        self.analyzer = analyzer
    }

    func analyzeIfReady(_ composition: TethrCompositionState) async throws -> TethrSharedSegmentMap? {
        guard composition.canAnalyzeSharedSegments else { return nil }
        return try await analyzer.analyzeSharedSegments(for: composition.sources)
    }
}

struct TethrPlaceholderSharedSegmentAnalyzer: TethrSharedSegmentAnalyzing {
    var targetSegmentDuration: TimeInterval = 12
    var minimumSegmentDuration: TimeInterval = 3

    func analyzeSharedSegments(for sources: [TethrSourceTrack]) async throws -> TethrSharedSegmentMap {
        guard sources.count >= 2 else {
            throw TethrSharedSegmentAnalysisError.insufficientSources
        }

        let usableDuration = sources
            .map(\.duration)
            .filter { $0.isFinite && $0 > minimumSegmentDuration }
            .min()

        guard let usableDuration else {
            throw TethrSharedSegmentAnalysisError.missingUsableDuration
        }

        var segments: [TethrSharedSegment] = []
        var cursor: TimeInterval = 0
        var index = 0

        while cursor < usableDuration {
            let remaining = usableDuration - cursor
            let duration = min(targetSegmentDuration, remaining)
            if duration < minimumSegmentDuration, let last = segments.indices.last {
                segments[last].duration += duration
                break
            }

            index += 1
            segments.append(
                TethrSharedSegment(
                    index: index,
                    startTime: cursor,
                    duration: duration,
                    label: String(format: "Segment %02d", index)
                )
            )
            cursor += duration
        }

        return TethrSharedSegmentMap(
            sourceIDs: sources.map(\.id),
            segments: segments,
            confidence: 0
        )
    }
}
