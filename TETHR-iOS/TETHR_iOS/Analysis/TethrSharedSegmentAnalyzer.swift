import Foundation

enum TethrSharedSegmentAnalysisError: Error, Equatable {
    case missingSources
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
    var fallbackBpm: Double = 120

    func analyzeSharedSegments(for sources: [TethrSourceTrack]) async throws -> TethrSharedSegmentMap {
        guard !sources.isEmpty else {
            throw TethrSharedSegmentAnalysisError.missingSources
        }

        let usableDuration = sources
            .map(\.duration)
            .filter { $0.isFinite && $0 > minimumSegmentDuration }
            .min()

        guard let usableDuration else {
            throw TethrSharedSegmentAnalysisError.missingUsableDuration
        }

        let tempoEstimate = mergedTempoEstimate(for: sources, duration: usableDuration)
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
            beatMarkers: beatMarkers(
                duration: usableDuration,
                bpm: tempoEstimate.bpm,
                confidence: tempoEstimate.confidence
            ),
            detectedBpm: tempoEstimate.bpm,
            confidence: tempoEstimate.confidence
        )
    }

    private func mergedTempoEstimate(
        for sources: [TethrSourceTrack],
        duration: TimeInterval
    ) -> TethrTempoEstimate {
        let estimates = sources.compactMap { source -> TethrTempoEstimate? in
            guard let detectedBpm = source.detectedBpm else { return nil }
            return TethrTempoEstimate(
                bpm: detectedBpm,
                confidence: source.bpmConfidence ?? 0.45
            )
        }

        guard !estimates.isEmpty else {
            return TethrTempoEstimate(
                bpm: fallbackTempo(for: duration),
                confidence: 0.32
            )
        }

        let weightedConfidence = estimates.reduce(0) { $0 + max(0.05, $1.confidence) }
        let weightedBpm = estimates.reduce(0) { partial, estimate in
            partial + estimate.bpm * max(0.05, estimate.confidence)
        } / weightedConfidence
        let averageConfidence = estimates.reduce(0) { $0 + $1.confidence } / Double(estimates.count)

        return TethrTempoEstimate(
            bpm: min(max(weightedBpm, 60), 200),
            confidence: min(0.95, max(0.32, averageConfidence))
        )
    }

    private func beatMarkers(
        duration: TimeInterval,
        bpm: Double,
        confidence: Double
    ) -> [TethrBeatMarker] {
        guard duration.isFinite, duration > 0, bpm > 0 else { return [] }

        let beatInterval = 60 / bpm
        let markerCount = min(96, max(0, Int(duration / beatInterval)))

        return (0..<markerCount).map { index in
            let correctedTime = Double(index) * beatInterval
            let drift = syntheticDrift(forBeatAt: index)
            let detectedTime = min(duration, max(0, correctedTime + drift))

            return TethrBeatMarker(
                beatIndex: index,
                detectedTime: detectedTime,
                confidence: confidence
            )
        }
    }

    private func syntheticDrift(forBeatAt index: Int) -> TimeInterval {
        let slowPhrase = sin(Double(index) * 0.57) * 0.034
        let barPush = sin(Double(index) * 1.91 + 0.7) * 0.018
        return slowPhrase + barPush
    }

    private func fallbackTempo(for duration: TimeInterval) -> Double {
        guard duration.isFinite, duration > 0 else { return fallbackBpm }

        let likelyBeatCounts = [64, 96, 128, 160, 192, 224, 256, 320, 384, 448]
        let candidates = likelyBeatCounts
            .map { Double($0) * 60 / duration }
            .filter { 60...200 ~= $0 }

        return candidates.min { abs($0 - fallbackBpm) < abs($1 - fallbackBpm) } ?? fallbackBpm
    }
}
