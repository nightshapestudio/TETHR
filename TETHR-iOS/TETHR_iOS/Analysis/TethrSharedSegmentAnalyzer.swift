import Accelerate
import AVFoundation
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

    init(analyzer: TethrSharedSegmentAnalyzing = TethrStructuralSegmentAnalyzer()) {
        self.analyzer = analyzer
    }

    func analyzeIfReady(_ composition: TethrCompositionState) async throws -> TethrSharedSegmentMap? {
        guard composition.canAnalyzeSharedSegments else { return nil }
        return try await analyzer.analyzeSharedSegments(for: composition.sources)
    }
}

// MARK: - Structure-aware analyzer (deterministic, bar-aligned)

/// Pipeline conformer that runs the deterministic `TethrAudioAnalyzer` on the
/// primary take's audio. Sections are shared across takes, so structure is
/// derived from TAKE A. Labels are neutral (SEGMENT 01…) — no semantic guesses.
struct TethrStructuralSegmentAnalyzer: TethrSharedSegmentAnalyzing {
    func analyzeSharedSegments(for sources: [TethrSourceTrack]) async throws -> TethrSharedSegmentMap {
        guard !sources.isEmpty else { throw TethrSharedSegmentAnalysisError.missingSources }
        guard let primary = sources.first(where: { $0.slot == .primary }) ?? sources.first,
              let url = primary.originalURL else {
            throw TethrSharedSegmentAnalysisError.missingUsableDuration
        }
        // `analyze` never throws — it returns a graceful fallback map on error.
        return await TethrAudioAnalyzer().analyze(url: url, sourceID: primary.id)
    }
}

// MARK: - TethrAudioAnalyzer (Replit-audited, adjusted to app model types)
//
// Deterministic musical segmentation pipeline. No AI, no semantic labels.
//   1. Read PCM via AVAudioFile → mix to mono via vDSP (capped for long files)
//   2. Build coarse RMS energy envelope (50 ms frames)
//   3. Estimate BPM via onset-energy autocorrelation
//   4. Build TethrBeatMarker array when BPM is credible
//   5. Derive bar grid (beatsPerBar = 4)
//   6. Score each bar boundary by novelty (energy flux across neighbours)
//   7. Select boundaries above adaptive threshold
//   8. Merge segments shorter than 4 bars
//   9. Prefer 8- / 16-bar boundaries where novelty supports it
//  10. Fallback: even ~16 s chunks when BPM grid fails, barStart/barEnd nil

actor TethrAudioAnalyzer {

    struct Config {
        var frameDuration: TimeInterval = 0.05      // 50 ms RMS frame
        var smoothingWindowFrames: Int = 5
        var minBPM: Double = 60
        var maxBPM: Double = 200
        var minBPMConfidence: Double = 0.35
        var minBarsPerSegment: Int = 4              // musical minimum, merges tiny slices
        var maxSegments: Int = 16
        var fallbackChunkSeconds: TimeInterval = 16.0
        var noveltyThresholdK: Float = 0.6
        var beatsPerBar: Int = 4
        /// Hard cap on how much audio we load into memory at once.
        var maxAnalysisSeconds: TimeInterval = 720
    }

    private let config: Config

    init(config: Config = Config()) {
        self.config = config
    }

    /// Analyse `url` and return a TethrSharedSegmentMap keyed by `sourceID`.
    /// Never throws to the caller — errors produce a fallback map instead.
    func analyze(url: URL, sourceID: TethrSourceTrack.ID) async -> TethrSharedSegmentMap {
        do {
            return try await _analyze(url: url, sourceID: sourceID)
        } catch {
            let duration = (try? fileDuration(url: url)) ?? 0
            return TethrSharedSegmentMap(
                sourceIDs: [sourceID],
                segments: fallbackSegments(duration: duration, sourceID: sourceID),
                beatMarkers: [],
                detectedBpm: nil,
                confidence: 0,
                beatsPerBar: config.beatsPerBar
            )
        }
    }

    // MARK: - Pipeline

    private func _analyze(url: URL, sourceID: TethrSourceTrack.ID) async throws -> TethrSharedSegmentMap {
        let (samples, sampleRate, duration) = try loadMono(url: url)

        let frameSize = max(1, Int(sampleRate * config.frameDuration))
        let rawEnvelope = rmsEnvelope(samples: samples, frameSize: frameSize)
        let envelope = smooth(rawEnvelope, windowSize: config.smoothingWindowFrames)

        let frameRate = sampleRate / Double(frameSize)
        let (bpm, bpmConfidence) = estimateBPM(
            envelope: envelope, frameRate: frameRate, minBPM: config.minBPM, maxBPM: config.maxBPM
        )

        if let bpm, bpmConfidence >= config.minBPMConfidence {
            return gridBasedMap(
                envelope: envelope, frameRate: frameRate, duration: duration,
                bpm: bpm, confidence: bpmConfidence, sourceID: sourceID
            )
        } else {
            return TethrSharedSegmentMap(
                sourceIDs: [sourceID],
                segments: fallbackSegments(duration: duration, sourceID: sourceID),
                beatMarkers: [],
                detectedBpm: bpm,
                confidence: bpmConfidence,
                beatsPerBar: config.beatsPerBar
            )
        }
    }

    // MARK: - Grid-based segmentation

    private func gridBasedMap(
        envelope: [Float], frameRate: Double, duration: TimeInterval,
        bpm: Double, confidence: Double, sourceID: TethrSourceTrack.ID
    ) -> TethrSharedSegmentMap {
        let beatDuration = 60.0 / bpm
        let barDuration  = beatDuration * Double(config.beatsPerBar)
        let framesPerBar = max(1, Int(barDuration * frameRate))
        let totalBars    = max(1, Int(duration / barDuration))

        let beatMarkers = buildBeatMarkers(bpm: bpm, duration: duration)
        let barEnergy = buildBarEnergy(envelope: envelope, framesPerBar: framesPerBar, totalBars: totalBars)
        let novelty = noveltyScore(barEnergy: barEnergy)

        let mean = novelty.reduce(0, +) / Float(max(1, novelty.count))
        let variance = novelty.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Float(max(1, novelty.count))
        let threshold = mean + config.noveltyThresholdK * sqrt(variance)

        var candidateBars: [Int] = [0]
        for b in 1..<totalBars where novelty[b] >= threshold { candidateBars.append(b) }
        candidateBars.append(totalBars)

        let mergedBars = mergeShortBoundaries(barBoundaries: candidateBars, minBars: config.minBarsPerSegment, totalBars: totalBars)
        let snappedBars = snapToMusicalGrid(barBoundaries: mergedBars, totalBars: totalBars, barDuration: barDuration, duration: duration)
        let cappedBars = capBoundaries(snappedBars, max: config.maxSegments + 1)
        let segments = buildSegments(barBoundaries: cappedBars, barDuration: barDuration, duration: duration)

        return TethrSharedSegmentMap(
            sourceIDs: [sourceID],
            segments: segments,
            beatMarkers: beatMarkers,
            detectedBpm: bpm,
            confidence: confidence,
            beatsPerBar: config.beatsPerBar
        )
    }

    // MARK: - PCM loading

    private func loadMono(url: URL) throws -> (samples: [Float], sampleRate: Double, duration: TimeInterval) {
        let file       = try AVAudioFile(forReading: url)
        let format     = file.processingFormat
        let sampleRate = format.sampleRate
        guard sampleRate > 0 else { throw TethrAnalyzerError.noChannelData }

        // Cap how much we read into memory so very long files can't OOM.
        let cap        = AVAudioFramePosition(sampleRate * config.maxAnalysisSeconds)
        let frameCount = AVAudioFrameCount(max(0, min(file.length, cap)))
        let duration   = Double(file.length) / sampleRate

        guard frameCount > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
            throw TethrAnalyzerError.bufferAllocationFailed
        }
        try file.read(into: buffer)
        guard let channelData = buffer.floatChannelData else { throw TethrAnalyzerError.noChannelData }

        let channels    = Int(format.channelCount)
        let frameLength = Int(buffer.frameLength)
        var mono        = [Float](repeating: 0, count: frameLength)

        for ch in 0..<channels {
            let ptr = channelData[ch]
            for i in 0..<frameLength { mono[i] += ptr[i] }
        }
        if channels > 1 {
            let scale = Float(1.0 / Double(channels))
            vDSP_vsmul(mono, 1, [scale], &mono, 1, vDSP_Length(frameLength))
        }
        return (mono, sampleRate, duration)
    }

    private func fileDuration(url: URL) throws -> TimeInterval {
        let file = try AVAudioFile(forReading: url)
        return Double(file.length) / file.processingFormat.sampleRate
    }

    // MARK: - RMS envelope

    private func rmsEnvelope(samples: [Float], frameSize: Int) -> [Float] {
        let count = samples.count / frameSize
        var env   = [Float](repeating: 0, count: count)
        for i in 0..<count {
            let start = i * frameSize
            let end   = min(start + frameSize, samples.count)
            var rms: Float = 0
            vDSP_rmsqv(Array(samples[start..<end]), 1, &rms, vDSP_Length(end - start))
            env[i] = rms
        }
        return env
    }

    private func smooth(_ signal: [Float], windowSize: Int) -> [Float] {
        guard signal.count > windowSize, windowSize > 1 else { return signal }
        let half   = windowSize / 2
        var result = [Float](repeating: 0, count: signal.count)
        for i in 0..<signal.count {
            let lo = max(0, i - half)
            let hi = min(signal.count - 1, i + half)
            let slice = signal[lo...hi]
            result[i] = slice.reduce(0, +) / Float(slice.count)
        }
        return result
    }

    // MARK: - BPM estimation (onset autocorrelation)

    private func estimateBPM(
        envelope: [Float], frameRate: Double, minBPM: Double, maxBPM: Double
    ) -> (bpm: Double?, confidence: Double) {
        guard envelope.count > 4 else { return (nil, 0) }

        var onset = [Float](repeating: 0, count: envelope.count)
        for i in 1..<envelope.count { onset[i] = max(0, envelope[i] - envelope[i - 1]) }

        let minLag = max(1, Int(frameRate * 60.0 / maxBPM))
        let maxLag = Int(frameRate * 60.0 / minBPM)
        guard minLag < maxLag, maxLag < onset.count else { return (nil, 0) }

        var scores = [Float](repeating: 0, count: maxLag - minLag + 1)
        let compareLen = onset.count - maxLag
        for (idx, lag) in (minLag...maxLag).enumerated() {
            var score: Float = 0
            for i in 0..<compareLen { score += onset[i] * onset[i + lag] }
            scores[idx] = score
        }

        guard let bestScore = scores.max(), bestScore > 0 else { return (nil, 0) }
        let bestLag = minLag + scores.firstIndex(of: bestScore)!

        // Confidence = how far the best lag stands above the average lag score.
        // ratio is ~1 for flat/noise and grows with a clear periodic peak;
        // map ratio 1→0, ~7→1 so a credible beat clears the grid threshold.
        let meanScore = scores.reduce(0, +) / Float(scores.count)
        let ratio = meanScore > 0 ? Double(bestScore / meanScore) : 0
        let confidence = min(1.0, max(0.0, (ratio - 1.0) / 6.0))

        let bpm = 60.0 / (Double(bestLag) / frameRate)
        guard bpm >= minBPM, bpm <= maxBPM else { return (nil, 0) }
        return (bpm, confidence)
    }

    // MARK: - Beat markers

    private func buildBeatMarkers(bpm: Double, duration: TimeInterval) -> [TethrBeatMarker] {
        let beatDuration = 60.0 / bpm
        var markers: [TethrBeatMarker] = []
        var t = 0.0
        var beatIndex = 0
        while t < duration {
            markers.append(TethrBeatMarker(beatIndex: beatIndex, detectedTime: t, confidence: 1.0))
            t += beatDuration
            beatIndex += 1
        }
        return markers
    }

    // MARK: - Bar energy + novelty

    private func buildBarEnergy(envelope: [Float], framesPerBar: Int, totalBars: Int) -> [Float] {
        var barEnergy = [Float](repeating: 0, count: totalBars)
        for b in 0..<totalBars {
            let start = b * framesPerBar
            let end   = min(start + framesPerBar, envelope.count)
            if end > start { barEnergy[b] = envelope[start..<end].reduce(0, +) / Float(end - start) }
        }
        return barEnergy
    }

    private func noveltyScore(barEnergy: [Float]) -> [Float] {
        let n = barEnergy.count
        var novelty = [Float](repeating: 0, count: n)
        guard n > 1 else { return novelty }
        for b in 1..<(n - 1) {
            novelty[b] = abs(barEnergy[b] - barEnergy[b - 1]) + abs(barEnergy[b] - barEnergy[b + 1])
        }
        novelty[0]     = abs(barEnergy[0] - barEnergy[1])
        novelty[n - 1] = abs(barEnergy[n - 1] - barEnergy[n - 2])
        return novelty
    }

    // MARK: - Boundary merging / snapping / capping

    private func mergeShortBoundaries(barBoundaries: [Int], minBars: Int, totalBars: Int) -> [Int] {
        var result = barBoundaries
        var changed = true
        while changed {
            changed = false
            var i = 0
            while i < result.count - 1 {
                if result[i + 1] - result[i] < minBars && result.count > 2 {
                    result.remove(at: i + 1)
                    changed = true
                } else {
                    i += 1
                }
            }
        }
        return result
    }

    private func snapToMusicalGrid(barBoundaries: [Int], totalBars: Int, barDuration: TimeInterval, duration: TimeInterval) -> [Int] {
        let quanta = [16, 8]
        var result = barBoundaries
        guard result.count > 2 else { return result }
        for i in 1..<(result.count - 1) {
            let bar = result[i]
            for q in quanta {
                let nearest = Int((Double(bar) / Double(q)).rounded()) * q
                if abs(bar - nearest) <= 1, nearest > 0, nearest < totalBars {
                    result[i] = nearest
                    break
                }
            }
        }
        var seen = Set<Int>()
        result = result.filter { seen.insert($0).inserted }
        result.sort()
        return result
    }

    private func capBoundaries(_ boundaries: [Int], max maxCount: Int) -> [Int] {
        guard boundaries.count > maxCount, maxCount >= 2 else { return boundaries }
        let interior = Array(boundaries.dropFirst().dropLast())
        let step = max(1, interior.count / (maxCount - 2))
        var kept: [Int] = [boundaries.first!]
        for i in stride(from: 0, to: interior.count, by: step) { kept.append(interior[i]) }
        kept.append(boundaries.last!)
        return kept
    }

    // MARK: - Segment construction

    private func buildSegments(barBoundaries: [Int], barDuration: TimeInterval, duration: TimeInterval) -> [TethrSharedSegment] {
        guard barBoundaries.count >= 2 else { return [] }
        var segments: [TethrSharedSegment] = []
        for i in 0..<(barBoundaries.count - 1) {
            let startBar = barBoundaries[i]
            let endBar   = barBoundaries[i + 1]
            let startTime = Double(startBar) * barDuration
            let endTime   = i == barBoundaries.count - 2 ? duration : Double(endBar) * barDuration
            let segDuration = endTime - startTime
            guard segDuration > 0 else { continue }

            let index = i + 1
            segments.append(
                TethrSharedSegment(
                    index: index,
                    startTime: startTime,
                    duration: segDuration,
                    label: String(format: "SEGMENT %02d", index),
                    barStart: startBar + 1,   // 1-based for display
                    barEnd: endBar            // inclusive last bar
                )
            )
        }
        return segments
    }

    // MARK: - Fallback (no BPM grid) — even usable chunks, neutral labels, no bars

    private func fallbackSegments(duration: TimeInterval, sourceID: TethrSourceTrack.ID) -> [TethrSharedSegment] {
        guard duration > 0 else { return [] }
        let targetCount = max(4, min(config.maxSegments, Int(duration / config.fallbackChunkSeconds)))
        let chunkDuration = duration / Double(targetCount)
        var segments: [TethrSharedSegment] = []
        for i in 0..<targetCount {
            let startTime = Double(i) * chunkDuration
            let endTime   = i == targetCount - 1 ? duration : Double(i + 1) * chunkDuration
            let segDuration = endTime - startTime
            guard segDuration > 0 else { continue }
            let index = i + 1
            segments.append(
                TethrSharedSegment(
                    index: index, startTime: startTime, duration: segDuration,
                    label: String(format: "SEGMENT %02d", index), barStart: nil, barEnd: nil
                )
            )
        }
        return segments
    }
}

enum TethrAnalyzerError: Error, LocalizedError {
    case bufferAllocationFailed
    case noChannelData

    var errorDescription: String? {
        switch self {
        case .bufferAllocationFailed: return "Failed to allocate PCM buffer"
        case .noChannelData:          return "Audio file contains no channel data"
        }
    }
}

// MARK: - Shared tempo / beat-marker helpers

func tethrMergedTempo(
    for sources: [TethrSourceTrack],
    duration: TimeInterval,
    fallbackBpm: Double
) -> TethrTempoEstimate {
    let estimates = sources.compactMap { source -> TethrTempoEstimate? in
        guard let detectedBpm = source.detectedBpm else { return nil }
        return TethrTempoEstimate(bpm: detectedBpm, confidence: source.bpmConfidence ?? 0.45)
    }

    guard !estimates.isEmpty else {
        return TethrTempoEstimate(bpm: tethrFallbackTempo(for: duration, fallbackBpm: fallbackBpm), confidence: 0.32)
    }

    let weightedConfidence = estimates.reduce(0) { $0 + max(0.05, $1.confidence) }
    let weightedBpm = estimates.reduce(0) { $0 + $1.bpm * max(0.05, $1.confidence) } / weightedConfidence
    let averageConfidence = estimates.reduce(0) { $0 + $1.confidence } / Double(estimates.count)
    return TethrTempoEstimate(
        bpm: min(max(weightedBpm, 60), 200),
        confidence: min(0.95, max(0.32, averageConfidence))
    )
}

func tethrBeatMarkers(duration: TimeInterval, bpm: Double, confidence: Double) -> [TethrBeatMarker] {
    guard duration.isFinite, duration > 0, bpm > 0 else { return [] }
    let beatInterval = 60 / bpm
    let markerCount = min(96, max(0, Int(duration / beatInterval)))
    return (0..<markerCount).map { index in
        let corrected = Double(index) * beatInterval
        let drift = sin(Double(index) * 0.57) * 0.034 + sin(Double(index) * 1.91 + 0.7) * 0.018
        return TethrBeatMarker(
            beatIndex: index,
            detectedTime: min(duration, max(0, corrected + drift)),
            confidence: confidence
        )
    }
}

private func tethrFallbackTempo(for duration: TimeInterval, fallbackBpm: Double) -> Double {
    guard duration.isFinite, duration > 0 else { return fallbackBpm }
    let likelyBeatCounts = [64, 96, 128, 160, 192, 224, 256, 320, 384, 448]
    let candidates = likelyBeatCounts
        .map { Double($0) * 60 / duration }
        .filter { 60...200 ~= $0 }
    return candidates.min { abs($0 - fallbackBpm) < abs($1 - fallbackBpm) } ?? fallbackBpm
}

// MARK: - Legacy fixed-window analyzer (kept for tests)

struct TethrPlaceholderSharedSegmentAnalyzer: TethrSharedSegmentAnalyzing {
    var targetSegmentDuration: TimeInterval = 12
    var minimumSegmentDuration: TimeInterval = 3
    var fallbackBpm: Double = 120

    func analyzeSharedSegments(for sources: [TethrSourceTrack]) async throws -> TethrSharedSegmentMap {
        guard !sources.isEmpty else { throw TethrSharedSegmentAnalysisError.missingSources }

        let usableDuration = sources
            .map(\.duration)
            .filter { $0.isFinite && $0 > minimumSegmentDuration }
            .min()
        guard let usableDuration else { throw TethrSharedSegmentAnalysisError.missingUsableDuration }

        let tempo = tethrMergedTempo(for: sources, duration: usableDuration, fallbackBpm: fallbackBpm)
        var segments: [TethrSharedSegment] = []
        var cursor: TimeInterval = 0
        var index = 0
        while cursor < usableDuration {
            let duration = min(targetSegmentDuration, usableDuration - cursor)
            if duration < minimumSegmentDuration, let last = segments.indices.last {
                segments[last].duration += duration
                break
            }
            index += 1
            segments.append(
                TethrSharedSegment(index: index, startTime: cursor, duration: duration, label: String(format: "SEGMENT %02d", index))
            )
            cursor += duration
        }

        return TethrSharedSegmentMap(
            sourceIDs: sources.map(\.id),
            segments: segments,
            beatMarkers: tethrBeatMarkers(duration: usableDuration, bpm: tempo.bpm, confidence: tempo.confidence),
            detectedBpm: tempo.bpm,
            confidence: tempo.confidence
        )
    }
}
