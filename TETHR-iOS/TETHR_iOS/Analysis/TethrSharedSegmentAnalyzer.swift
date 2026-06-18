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

// MARK: - Structure-aware analyzer

/// Detects obvious song sections (intro / drop / verse / break / outro-like
/// boundaries) from audio, then derives editable, bar-aligned segments. Falls
/// back to bar-aligned 16-bar sections when structure is unclear — never random
/// equal-duration chunks.
struct TethrStructuralSegmentAnalyzer: TethrSharedSegmentAnalyzing {
    var fallbackBpm: Double = 120
    private let minimumDuration: TimeInterval = 3

    func analyzeSharedSegments(for sources: [TethrSourceTrack]) async throws -> TethrSharedSegmentMap {
        guard !sources.isEmpty else { throw TethrSharedSegmentAnalysisError.missingSources }

        let usableDuration = sources
            .map(\.duration)
            .filter { $0.isFinite && $0 > minimumDuration }
            .min()
        guard let usableDuration else { throw TethrSharedSegmentAnalysisError.missingUsableDuration }

        let tempo = tethrMergedTempo(for: sources, duration: usableDuration, fallbackBpm: fallbackBpm)
        let bpm = tempo.bpm

        // Analyze the primary take's audio for structure (sections are shared).
        let url = (sources.first { $0.slot == .primary } ?? sources.first)?.originalURL

        let detection: TethrStructureResult
        if let url {
            detection = await Task.detached(priority: .userInitiated) {
                TethrStructureDetector(bpm: bpm, totalDuration: usableDuration).detect(url: url)
            }.value
        } else {
            detection = TethrStructureDetector.fallbackSections(duration: usableDuration, bpm: bpm)
        }

        return TethrSharedSegmentMap(
            sourceIDs: sources.map(\.id),
            segments: detection.segments,
            beatMarkers: tethrBeatMarkers(duration: usableDuration, bpm: bpm, confidence: tempo.confidence),
            detectedBpm: bpm,
            confidence: detection.confidence
        )
    }
}

// MARK: - Structure detector

struct TethrStructureResult: Sendable {
    var segments: [TethrSharedSegment]
    var confidence: Double
}

/// Reads a track, builds beat-synchronous feature windows, and finds the major
/// structural boundaries via a novelty curve. Pure over Sendable inputs.
struct TethrStructureDetector: Sendable {
    let bpm: Double
    let totalDuration: TimeInterval

    // Analysis parameters.
    private let fftSize = 2_048
    private let hopSize = 1_024
    private let beatsPerBar = 4
    private let minSectionBars = 8       // never produce shorter sections
    private let fallbackBars = 16        // section length when structure is unclear
    private let maxSections = 8
    private let noveltyWindowBeats = 8   // ± window for the before/after contrast
    private let maxAnalysisSeconds: TimeInterval = 480

    func detect(url: URL) -> TethrStructureResult {
        let safeBpm = bpm > 0 ? bpm : 120
        guard let beats = try? beatFeatures(url: url, bpm: safeBpm), beats.count > minSectionBars * beatsPerBar else {
            return Self.fallbackSections(duration: totalDuration, bpm: safeBpm)
        }

        let novelty = noveltyCurve(beats)
        let (boundaries, confidence) = pickBoundaries(novelty: novelty, beatCount: beats.count)

        // Too few clear boundaries → bar-aligned fallback rather than guesses.
        guard boundaries.count >= 1, confidence >= 0.4 else {
            return Self.fallbackSections(duration: totalDuration, bpm: safeBpm)
        }

        let beatDuration = 60.0 / safeBpm
        let cuts = ([0] + boundaries + [beats.count]).sorted()
        var sections: [(start: Int, end: Int, energy: Double)] = []
        for i in 0..<(cuts.count - 1) {
            let s = cuts[i], e = cuts[i + 1]
            guard e > s else { continue }
            let energy = beats[s..<e].reduce(0.0) { $0 + Double($1.rms) } / Double(e - s)
            sections.append((s, e, energy))
        }
        guard !sections.isEmpty else {
            return Self.fallbackSections(duration: totalDuration, bpm: safeBpm)
        }

        let labels = labelSections(sections)
        let segments = sections.enumerated().map { idx, section -> TethrSharedSegment in
            let start = Double(section.start) * beatDuration
            let end = min(totalDuration, Double(section.end) * beatDuration)
            return TethrSharedSegment(
                index: idx + 1,
                startTime: start,
                duration: max(0, end - start),
                label: labels[idx]
            )
        }

        return TethrStructureResult(segments: segments, confidence: confidence)
    }

    // MARK: Feature extraction (beat-synchronous)

    private struct BeatFeature {
        var rms: Float = 0
        var centroid: Float = 0
        var lowEnergy: Float = 0
        var flux: Float = 0
        var chroma = [Float](repeating: 0, count: 12)
    }

    private func beatFeatures(url: URL, bpm: Double) throws -> [BeatFeature] {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        let sampleRate = format.sampleRate
        guard sampleRate > 0, let fft = TethrFFT(size: fftSize, sampleRate: sampleRate) else { return [] }

        let channels = Int(format.channelCount)
        let maxFrames = min(file.length, AVAudioFramePosition(sampleRate * maxAnalysisSeconds))
        let chunkCapacity: AVAudioFrameCount = 1 << 16
        guard let readBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunkCapacity) else { return [] }

        let beatDuration = 60.0 / bpm
        let frameHopDuration = Double(hopSize) / sampleRate
        let estimatedBeats = max(1, Int(totalDuration / beatDuration) + 2)
        var beats = [BeatFeature](repeating: BeatFeature(), count: estimatedBeats)
        var beatFrameCounts = [Int](repeating: 0, count: estimatedBeats)

        var carry = [Float]()
        var prevMag = [Float](repeating: 0, count: fftSize / 2)
        var frameIndex = 0
        var read: AVAudioFramePosition = 0

        while read < maxFrames {
            let toRead = AVAudioFrameCount(min(AVAudioFramePosition(chunkCapacity), maxFrames - read))
            try file.read(into: readBuffer, frameCount: toRead)
            let n = Int(readBuffer.frameLength)
            if n == 0 { break }
            read += AVAudioFramePosition(n)
            appendMono(readBuffer, frames: n, channels: channels, into: &carry)

            var offset = 0
            while offset + fftSize <= carry.count {
                let frame = Array(carry[offset..<offset + fftSize])
                let feature = frameFeature(frame, fft: fft, prevMag: &prevMag)
                let time = Double(frameIndex) * frameHopDuration
                let beat = Int(time / beatDuration)
                if beat >= 0, beat < beats.count {
                    accumulate(feature, into: &beats[beat])
                    beatFrameCounts[beat] += 1
                }
                frameIndex += 1
                offset += hopSize
            }
            if offset > 0 { carry.removeFirst(offset) }
        }

        // Average per beat; trim empty trailing beats.
        var result: [BeatFeature] = []
        for i in 0..<beats.count where beatFrameCounts[i] > 0 {
            let c = Float(beatFrameCounts[i])
            var b = beats[i]
            b.rms /= c; b.centroid /= c; b.lowEnergy /= c; b.flux /= c
            for k in 0..<12 { b.chroma[k] /= c }
            result.append(b)
        }
        normalizeScalars(&result)
        return result
    }

    private func frameFeature(_ frame: [Float], fft: TethrFFT, prevMag: inout [Float]) -> BeatFeature {
        var feature = BeatFeature()
        var meanSquare: Float = 0
        vDSP_measqv(frame, 1, &meanSquare, vDSP_Length(frame.count))
        feature.rms = sqrt(meanSquare)

        let mags = fft.magnitude(frame)
        let binFreq = Float(fft.sampleRate) / Float(fft.size)
        var sumMag: Float = 0, sumFreqMag: Float = 0, lowSum: Float = 0, flux: Float = 0
        for k in 1..<mags.count {
            let m = mags[k]
            let f = Float(k) * binFreq
            sumMag += m
            sumFreqMag += f * m
            if f < 250 { lowSum += m }
            if f >= 80, f <= 5_000 { feature.chroma[pitchClass(f)] += m }
            let d = m - prevMag[k]
            if d > 0 { flux += d }
        }
        prevMag = mags
        feature.centroid = sumMag > 0 ? sumFreqMag / sumMag : 0
        feature.lowEnergy = sumMag > 0 ? lowSum / sumMag : 0
        feature.flux = flux
        let chromaSum = feature.chroma.reduce(0, +)
        if chromaSum > 0 { for k in 0..<12 { feature.chroma[k] /= chromaSum } }
        return feature
    }

    private func accumulate(_ f: BeatFeature, into b: inout BeatFeature) {
        b.rms += f.rms; b.centroid += f.centroid; b.lowEnergy += f.lowEnergy; b.flux += f.flux
        for k in 0..<12 { b.chroma[k] += f.chroma[k] }
    }

    private func appendMono(_ buffer: AVAudioPCMBuffer, frames n: Int, channels: Int, into out: inout [Float]) {
        guard let data = buffer.floatChannelData else { return }
        out.reserveCapacity(out.count + n)
        if channels <= 1 {
            let p = data[0]
            for i in 0..<n { out.append(p[i]) }
        } else {
            for i in 0..<n {
                var s: Float = 0
                for c in 0..<channels { s += data[c][i] }
                out.append(s / Float(channels))
            }
        }
    }

    private func pitchClass(_ freq: Float) -> Int {
        let midi = 69.0 + 12.0 * log2(Double(freq) / 440.0)
        let pc = Int(midi.rounded()) % 12
        return (pc + 12) % 12
    }

    /// z-score the scalar features so no single dimension dominates the novelty.
    private func normalizeScalars(_ beats: inout [BeatFeature]) {
        guard !beats.isEmpty else { return }
        func zscore(_ get: (BeatFeature) -> Float, _ set: (inout BeatFeature, Float) -> Void) {
            let values = beats.map(get)
            let mean = values.reduce(0, +) / Float(values.count)
            let variance = values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Float(values.count)
            let std = max(sqrt(variance), 1e-6)
            for i in beats.indices { set(&beats[i], (get(beats[i]) - mean) / std) }
        }
        zscore({ $0.rms }, { $0.rms = $1 })
        zscore({ $0.centroid }, { $0.centroid = $1 })
        zscore({ $0.lowEnergy }, { $0.lowEnergy = $1 })
        zscore({ $0.flux }, { $0.flux = $1 })
    }

    // MARK: Novelty

    /// Contrast between the mean feature just before and just after each beat —
    /// low within a section, high at a structural boundary.
    private func noveltyCurve(_ beats: [BeatFeature]) -> [Double] {
        let n = beats.count
        let w = noveltyWindowBeats
        var novelty = [Double](repeating: 0, count: n)
        for i in 0..<n {
            let before = meanFeature(beats, max(0, i - w), i)
            let after = meanFeature(beats, i, min(n, i + w))
            novelty[i] = distance(before, after)
        }
        return smooth(novelty, radius: 1)
    }

    private func meanFeature(_ beats: [BeatFeature], _ lo: Int, _ hi: Int) -> BeatFeature {
        var acc = BeatFeature()
        let count = max(1, hi - lo)
        for i in lo..<max(lo, hi) {
            acc.rms += beats[i].rms; acc.centroid += beats[i].centroid
            acc.lowEnergy += beats[i].lowEnergy; acc.flux += beats[i].flux
            for k in 0..<12 { acc.chroma[k] += beats[i].chroma[k] }
        }
        acc.rms /= Float(count); acc.centroid /= Float(count)
        acc.lowEnergy /= Float(count); acc.flux /= Float(count)
        for k in 0..<12 { acc.chroma[k] /= Float(count) }
        return acc
    }

    private func distance(_ a: BeatFeature, _ b: BeatFeature) -> Double {
        let energy = abs(Double(a.rms - b.rms))
        let centroid = abs(Double(a.centroid - b.centroid))
        let low = abs(Double(a.lowEnergy - b.lowEnergy))
        let flux = abs(Double(a.flux - b.flux))
        let chroma = 1.0 - cosineSimilarity(a.chroma, b.chroma) // harmonic/chord change
        return 1.0 * energy + 0.7 * low + 0.6 * centroid + 0.4 * flux + 1.2 * chroma
    }

    private func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Double {
        var dot: Double = 0, na: Double = 0, nb: Double = 0
        for k in 0..<min(a.count, b.count) {
            dot += Double(a[k]) * Double(b[k]); na += Double(a[k] * a[k]); nb += Double(b[k] * b[k])
        }
        guard na > 0, nb > 0 else { return 0 }
        return dot / (sqrt(na) * sqrt(nb))
    }

    private func smooth(_ x: [Double], radius: Int) -> [Double] {
        guard radius > 0 else { return x }
        var out = [Double](repeating: 0, count: x.count)
        for i in x.indices {
            var sum = 0.0, count = 0.0
            for j in max(0, i - radius)...min(x.count - 1, i + radius) { sum += x[j]; count += 1 }
            out[i] = sum / count
        }
        return out
    }

    // MARK: Boundary picking + snapping

    private func pickBoundaries(novelty: [Double], beatCount: Int) -> (boundaries: [Int], confidence: Double) {
        let sorted = novelty.sorted()
        let median = sorted[sorted.count / 2]
        let maxNovelty = sorted.last ?? 0
        let range = max(maxNovelty - median, 1e-9)

        // Threshold a fraction of the way from the in-section baseline (median)
        // up to the strongest boundary — robust to broad novelty bumps and to a
        // single dominant peak that would otherwise hide the others.
        let threshold = median + 0.4 * range
        // How clearly the track is structured at all: ~0 when flat/uniform.
        let peakiness = range / max(maxNovelty, 1e-9)
        let minSpacing = minSectionBars * beatsPerBar
        let bar = beatsPerBar
        guard beatCount > 2 * minSpacing else { return ([], 0) }

        // All local maxima above threshold across the whole interior. The peak of
        // a boundary bump can land a beat or two off the true bar line, so we keep
        // peaks near the edges too and resolve position by snapping (below).
        var candidates: [(beat: Int, value: Double)] = []
        for i in 1..<(beatCount - 1) where novelty[i] >= threshold {
            if novelty[i] >= novelty[i - 1], novelty[i] >= novelty[i + 1] {
                candidates.append((i, novelty[i]))
            }
        }
        candidates.sort { $0.value > $1.value }

        // Snap each peak to its nearest downbeat/bar first, THEN enforce edge
        // distance and minimum spacing on the snapped positions — so a boundary
        // whose peak is a beat early still lands on the correct bar line.
        var chosen: [Int] = []
        for candidate in candidates {
            guard chosen.count < maxSections - 1 else { break }
            let snapped = Int((Double(candidate.beat) / Double(bar)).rounded()) * bar
            guard snapped >= minSpacing, snapped <= beatCount - minSpacing else { continue }
            if chosen.allSatisfy({ abs($0 - snapped) >= minSpacing }) {
                chosen.append(snapped)
            }
        }
        chosen.sort()

        let confidence = chosen.isEmpty ? 0 : min(0.95, max(0, peakiness))
        return (chosen, confidence)
    }



    // MARK: Labels

    private func labelSections(_ sections: [(start: Int, end: Int, energy: Double)]) -> [String] {
        let n = sections.count
        guard n > 1 else { return ["A"] }

        var labels = [String](repeating: "", count: n)
        labels[0] = "INTRO"
        labels[n - 1] = "OUTRO"

        var interior = Array(1..<(n - 1))
        if let dropIdx = interior.max(by: { sections[$0].energy < sections[$1].energy }) {
            labels[dropIdx] = "DROP"
            interior.removeAll { $0 == dropIdx }
        }
        if let breakIdx = interior.min(by: { sections[$0].energy < sections[$1].energy }) {
            labels[breakIdx] = "BREAK"
            interior.removeAll { $0 == breakIdx }
        }
        for (offset, idx) in interior.enumerated() {
            labels[idx] = offset % 2 == 0 ? "A" : "B"
        }
        return labels
    }

    // MARK: Fallback — bar-aligned 16-bar sections (never random chunks)

    static func fallbackSections(duration: TimeInterval, bpm: Double) -> TethrStructureResult {
        let safeBpm = bpm > 0 ? bpm : 120
        let beatDuration = 60.0 / safeBpm
        let barDuration = beatDuration * 4
        let sectionDuration = barDuration * 16
        guard duration.isFinite, duration > 0, sectionDuration > 0 else {
            return TethrStructureResult(
                segments: [TethrSharedSegment(index: 1, startTime: 0, duration: max(0, duration), label: "A")],
                confidence: 0.3
            )
        }

        var segments: [TethrSharedSegment] = []
        var cursor: TimeInterval = 0
        var index = 0
        while cursor < duration - 0.001 {
            let end = min(duration, cursor + sectionDuration)
            // Fold a short trailing remainder (< 8 bars) into the previous section.
            if end - cursor < barDuration * 8, let last = segments.indices.last {
                segments[last].duration = duration - segments[last].startTime
                break
            }
            index += 1
            segments.append(
                TethrSharedSegment(
                    index: index,
                    startTime: cursor,
                    duration: end - cursor,
                    label: index == 1 ? "INTRO" : (index % 2 == 0 ? "A" : "B")
                )
            )
            cursor = end
        }
        if segments.isEmpty {
            segments = [TethrSharedSegment(index: 1, startTime: 0, duration: duration, label: "A")]
        }
        return TethrStructureResult(segments: segments, confidence: 0.3)
    }
}

// MARK: - Real FFT helper (Accelerate)

/// Windowed real FFT producing a magnitude spectrum. Wraps a vDSP setup so it is
/// created once per analysis pass.
final class TethrFFT {
    let size: Int
    let sampleRate: Double
    private let halfSize: Int
    private let log2n: vDSP_Length
    private let setup: FFTSetup
    private var window: [Float]
    private var realp: [Float]
    private var imagp: [Float]

    init?(size: Int, sampleRate: Double) {
        guard size > 0, (size & (size - 1)) == 0, sampleRate > 0,
              let setup = vDSP_create_fftsetup(vDSP_Length(log2(Double(size))), FFTRadix(kFFTRadix2)) else { return nil }
        self.size = size
        self.sampleRate = sampleRate
        self.halfSize = size / 2
        self.log2n = vDSP_Length(log2(Double(size)))
        self.setup = setup
        self.window = [Float](repeating: 0, count: size)
        vDSP_hann_window(&window, vDSP_Length(size), Int32(vDSP_HANN_NORM))
        self.realp = [Float](repeating: 0, count: size / 2)
        self.imagp = [Float](repeating: 0, count: size / 2)
    }

    deinit { vDSP_destroy_fftsetup(setup) }

    func magnitude(_ frame: [Float]) -> [Float] {
        guard frame.count == size else { return [Float](repeating: 0, count: halfSize) }
        var windowed = [Float](repeating: 0, count: size)
        vDSP_vmul(frame, 1, window, 1, &windowed, 1, vDSP_Length(size))

        var mags = [Float](repeating: 0, count: halfSize)
        realp.withUnsafeMutableBufferPointer { rp in
            imagp.withUnsafeMutableBufferPointer { ip in
                var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                windowed.withUnsafeBytes { raw in
                    let complex = raw.bindMemory(to: DSPComplex.self)
                    vDSP_ctoz(complex.baseAddress!, 2, &split, 1, vDSP_Length(halfSize))
                }
                vDSP_fft_zrip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                vDSP_zvabs(&split, 1, &mags, 1, vDSP_Length(halfSize))
            }
        }
        return mags
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
                TethrSharedSegment(index: index, startTime: cursor, duration: duration, label: String(format: "Segment %02d", index))
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
