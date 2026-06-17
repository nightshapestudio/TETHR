import AVFoundation
import Foundation
import os

// MARK: - Composite export

enum TethrExportError: LocalizedError {
    case nothingToExport
    case missingSource
    case renderFailed

    var errorDescription: String? {
        switch self {
        case .nothingToExport: return "There are no segments to export yet."
        case .missingSource:   return "An audio source for this export is missing."
        case .renderFailed:    return "TETHR couldn't render the export audio."
        }
    }
}

/// One render instruction: a time range pulled from a specific (already
/// sandbox-copied) source file. Sendable so it can cross to a background task.
struct TethrExportSegment: Sendable {
    let sourceURL: URL
    let startTime: TimeInterval
    let duration: TimeInterval
}

/// Concatenates the selected segment audio into a single WAV in the sandbox.
/// Pure over Sendable inputs so it can run off the main actor.
struct TethrCompositeExporter {
    func export(segments: [TethrExportSegment], referenceURL: URL) throws -> URL {
        guard !segments.isEmpty else { throw TethrExportError.nothingToExport }

        // Canonical output format taken from the primary source.
        let reference = try AVAudioFile(forReading: referenceURL)
        let sampleRate = reference.processingFormat.sampleRate
        let channels = reference.processingFormat.channelCount
        guard sampleRate > 0, channels > 0,
              let outFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: sampleRate,
                channels: channels,
                interleaved: false
              ) else { throw TethrExportError.renderFailed }

        try FileManager.default.createDirectory(
            at: TethrStorage.exportsDirectory,
            withIntermediateDirectories: true
        )
        let outURL = TethrStorage.exportsDirectory
            .appendingPathComponent("TETHR-\(Self.timestamp()).wav")

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false
        ]
        let outFile = try AVAudioFile(
            forWriting: outURL,
            settings: settings,
            commonFormat: .pcmFormatFloat32,
            interleaved: false
        )

        var openFiles: [String: AVAudioFile] = [:]
        for segment in segments {
            let file: AVAudioFile
            if let cached = openFiles[segment.sourceURL.path] {
                file = cached
            } else {
                file = try AVAudioFile(forReading: segment.sourceURL)
                openFiles[segment.sourceURL.path] = file
            }
            try append(segment, from: file, to: outFile, outFormat: outFormat)
        }

        return outURL
    }

    private func append(
        _ segment: TethrExportSegment,
        from file: AVAudioFile,
        to outFile: AVAudioFile,
        outFormat: AVAudioFormat
    ) throws {
        let inFormat = file.processingFormat
        let inRate = inFormat.sampleRate
        guard inRate > 0 else { throw TethrExportError.renderFailed }

        let startFrame = AVAudioFramePosition((segment.startTime * inRate).rounded())
        let wantedFrames = AVAudioFramePosition((segment.duration * inRate).rounded())
        let available = file.length - startFrame
        guard wantedFrames > 0, available > 0 else { return }

        let toRead = AVAudioFrameCount(min(wantedFrames, available))
        file.framePosition = startFrame
        guard let inBuffer = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: toRead) else {
            throw TethrExportError.renderFailed
        }
        try file.read(into: inBuffer, frameCount: toRead)
        guard inBuffer.frameLength > 0 else { return }

        if inFormat == outFormat {
            try outFile.write(from: inBuffer)
            return
        }

        // Sources with a different rate/channel layout are converted to match.
        guard let converter = AVAudioConverter(from: inFormat, to: outFormat) else {
            throw TethrExportError.renderFailed
        }
        let ratio = outFormat.sampleRate / inRate
        let capacity = AVAudioFrameCount(Double(inBuffer.frameLength) * ratio) + 1_024
        guard let outBuffer = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else {
            throw TethrExportError.renderFailed
        }

        var supplied = false
        var conversionError: NSError?
        converter.convert(to: outBuffer, error: &conversionError) { _, status in
            if supplied {
                status.pointee = .noDataNow
                return nil
            }
            supplied = true
            status.pointee = .haveData
            return inBuffer
        }
        if let conversionError { throw conversionError }
        guard outBuffer.frameLength > 0 else { return }
        try outFile.write(from: outBuffer)
    }

    private static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }
}

#if DEBUG
// DEBUG-IMPORT-FIXTURE: Simulator-only deterministic import fixture.
// Resolves a user-placed audio file in the app's Documents directory, or
// synthesizes a deterministic 120-BPM click WAV if none is found, so the real
// import pipeline can be exercised without the file picker or a Music library.
// To remove: delete this block, `importDebugFixture()` in the view model, and
// the DEBUG fixture button in TethrRootView (grep "DEBUG-IMPORT-FIXTURE").
enum TethrDebugFixture {
    /// Names searched (in Documents) before falling back to a synthesized file.
    static let candidateNames = [
        "tethr-fixture.wav", "tethr-fixture.mp3",
        "fixture.wav", "fixture.mp3",
        "test.wav", "test.mp3"
    ]

    private static var documentsDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    /// Returns an existing fixture URL or creates a synthesized one. The
    /// returned URL is a plain local file — it flows through the exact same
    /// `audioEngine.importSource(at:)` path as a picker selection.
    static func resolveOrCreate() throws -> URL {
        for name in candidateNames {
            let candidate = documentsDirectory.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
        }

        let synthesized = documentsDirectory.appendingPathComponent("tethr-fixture.wav")
        if FileManager.default.fileExists(atPath: synthesized.path) {
            return synthesized
        }
        try synthesizeClickTrack(to: synthesized)
        return synthesized
    }

    /// Writes a mono 44.1kHz WAV containing a 120-BPM click track (8 seconds),
    /// so the tempo analyzer has a clear, repeatable onset pattern to detect.
    private static func synthesizeClickTrack(to url: URL) throws {
        let sampleRate = 44_100.0
        let seconds = 48.0 // ~4 analyzer segments (12s each), fills the list
        let bpm = 120.0
        let totalFrames = AVAudioFrameCount(sampleRate * seconds)

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false
        ]

        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        ), let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: totalFrames
        ) else {
            throw TethrImportError.unreadableSource(url)
        }

        buffer.frameLength = totalFrames
        let samples = buffer.floatChannelData![0]

        let framesPerBeat = sampleRate * 60.0 / bpm
        let clickFrames = Int(sampleRate * 0.04) // 40ms transient
        let clickHz = 1_000.0

        for frame in 0..<Int(totalFrames) {
            let positionInBeat = Double(frame).truncatingRemainder(dividingBy: framesPerBeat)
            if positionInBeat < Double(clickFrames) {
                let t = positionInBeat / sampleRate
                let envelope = 1.0 - (positionInBeat / Double(clickFrames)) // linear decay
                samples[frame] = Float(sin(2.0 * .pi * clickHz * t) * envelope * 0.9)
            } else {
                samples[frame] = 0
            }
        }

        let file = try AVAudioFile(
            forWriting: url,
            settings: settings,
            commonFormat: .pcmFormatFloat32,
            interleaved: false
        )
        try file.write(from: buffer)
    }
}
#endif

enum TethrImportError: LocalizedError {
    case unreadableSource(URL)
    case copyFailed(URL, underlying: Error)

    var errorDescription: String? {
        switch self {
        case .unreadableSource(let url):
            return "TETHR couldn't read \u{201C}\(url.lastPathComponent)\u{201D}. "
                + "The file may live in iCloud and isn't downloaded, or it was moved. "
                + "Open the Files app, download it, then import again."
        case .copyFailed(let url, let underlying):
            return "TETHR couldn't import \u{201C}\(url.lastPathComponent)\u{201D}: "
                + underlying.localizedDescription
        }
    }
}

struct TethrTempoEstimate: Equatable {
    let bpm: Double
    let confidence: Double
}

struct TethrSourceSummary: Equatable {
    let fileName: String
    let duration: TimeInterval
    let playableURL: URL
    let tempoEstimate: TethrTempoEstimate?
}

protocol TethrAudioEngineProtocol: AnyObject {
    var currentTime: TimeInterval { get }
    var isPlaybackActive: Bool { get }

    func importSource(at url: URL) async throws -> TethrSourceSummary
    func playSource(at url: URL, from progress: Double, rate: Double) throws
    func setPlaybackRate(_ rate: Double)
    func pausePlayback()
    func stopPlayback()
}

final class TethrAudioEngine: TethrAudioEngineProtocol {
    private static let logger = Logger(subsystem: "com.nightshape.tethr", category: "import")

    private var player: AVAudioPlayer?
    private let tempoAnalyzer = TethrTempoAnalyzer()

    var currentTime: TimeInterval {
        player?.currentTime ?? 0
    }

    var isPlaybackActive: Bool {
        player?.isPlaying == true
    }

    func importSource(at url: URL) async throws -> TethrSourceSummary {
        let playableURL = try copyIntoImportsIfNeeded(url)
        let asset = AVURLAsset(url: playableURL)
        let duration = try await asset.load(.duration).seconds
        let normalizedDuration = duration.isFinite ? duration : 0
        let tempoEstimate = tempoAnalyzer.estimateTempo(
            at: playableURL,
            duration: normalizedDuration
        )

        return TethrSourceSummary(
            fileName: url.lastPathComponent,
            duration: normalizedDuration,
            playableURL: playableURL,
            tempoEstimate: tempoEstimate
        )
    }

    func playSource(at url: URL, from progress: Double, rate: Double) throws {
        try configureSession()

        if player?.url != url {
            player = try AVAudioPlayer(contentsOf: url)
            player?.prepareToPlay()
        }

        guard let player else { return }

        let clampedProgress = min(max(progress, 0), 0.999)
        player.enableRate = true
        player.rate = Float(clampedPlaybackRate(rate))

        if player.duration.isFinite && player.duration > 0 {
            player.currentTime = player.duration * clampedProgress
        }

        player.play()
    }

    func setPlaybackRate(_ rate: Double) {
        guard let player else { return }
        player.enableRate = true
        player.rate = Float(clampedPlaybackRate(rate))
    }

    func pausePlayback() {
        player?.pause()
    }

    func stopPlayback() {
        player?.stop()
        player?.currentTime = 0
    }

    private func configureSession() throws {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default)
        try session.setActive(true)
        #endif
    }

    private func clampedPlaybackRate(_ rate: Double) -> Double {
        min(2.0, max(0.5, rate.isFinite ? rate : 1.0))
    }

    private func copyIntoImportsIfNeeded(_ url: URL) throws -> URL {
        // Already inside our sandbox import directory: nothing to copy.
        if url.isFileURL, url.path.hasPrefix(importDirectory.path) {
            return url
        }

        try FileManager.default.createDirectory(
            at: importDirectory,
            withIntermediateDirectories: true
        )

        let safeName = url.lastPathComponent.isEmpty ? "source.audio" : url.lastPathComponent
        let destination = importDirectory
            .appendingPathComponent("\(UUID().uuidString)-\(safeName)")

        // Document-picker URLs (including iCloud / File Provider items) are
        // security-scoped and may be undownloaded placeholders. Hold access for
        // the entire read, ask iCloud to materialize evicted items, and use a
        // file coordinator so the copy reads a real, downloaded file.
        let didAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let isUbiquitous = (try? url.resourceValues(forKeys: [.isUbiquitousItemKey]))?.isUbiquitousItem == true
        if isUbiquitous {
            try? FileManager.default.startDownloadingUbiquitousItem(at: url)
        }

        var coordinatorError: NSError?
        var copyError: Error?
        NSFileCoordinator().coordinate(
            readingItemAt: url,
            options: [.withoutChanges],
            error: &coordinatorError
        ) { readURL in
            do {
                if FileManager.default.fileExists(atPath: destination.path) {
                    try FileManager.default.removeItem(at: destination)
                }
                try FileManager.default.copyItem(at: readURL, to: destination)
            } catch {
                copyError = error
            }
        }

        if let copyError {
            Self.logger.error("Copy failed for \(safeName, privacy: .public): \(copyError.localizedDescription, privacy: .public)")
            throw TethrImportError.copyFailed(url, underlying: copyError)
        }
        if let coordinatorError {
            Self.logger.error("Coordination failed for \(safeName, privacy: .public): \(coordinatorError.localizedDescription, privacy: .public)")
            throw TethrImportError.copyFailed(url, underlying: coordinatorError)
        }
        guard FileManager.default.fileExists(atPath: destination.path) else {
            Self.logger.error("Source unreadable after coordinated read: \(safeName, privacy: .public)")
            throw TethrImportError.unreadableSource(url)
        }

        return destination
    }

    private var importDirectory: URL {
        TethrStorage.importsDirectory
    }
}

private struct TethrTempoAnalyzer {
    private let minimumBpm = 60.0
    private let maximumBpm = 200.0
    private let maxAnalysisDuration: TimeInterval = 75
    // ~11.6ms at 44.1kHz. Fine enough to time onsets precisely for tempo;
    // a coarser hop quantizes onsets and biases the BPM low (e.g. 117 vs 120).
    private let hopSize = 512
    private let chunkFrames: AVAudioFrameCount = 16_384

    func estimateTempo(at url: URL, duration: TimeInterval) -> TethrTempoEstimate? {
        if let estimate = estimateFromEnvelope(at: url) {
            return estimate
        }

        guard duration.isFinite, duration > 0 else { return nil }
        let fallbackBpm = fallbackBpm(for: duration)
        return TethrTempoEstimate(bpm: fallbackBpm, confidence: 0.32)
    }

    private func estimateFromEnvelope(at url: URL) -> TethrTempoEstimate? {
        do {
            let file = try AVAudioFile(forReading: url)
            let format = file.processingFormat
            let sampleRate = format.sampleRate
            guard sampleRate > 0 else { return nil }

            let maxFrames = min(
                AVAudioFramePosition(sampleRate * maxAnalysisDuration),
                file.length
            )
            guard maxFrames > AVAudioFramePosition(sampleRate * 6) else { return nil }

            guard let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: chunkFrames
            ) else {
                return nil
            }

            var envelopes: [Double] = []
            var framesRead: AVAudioFramePosition = 0

            while framesRead < maxFrames {
                let remaining = AVAudioFrameCount(maxFrames - framesRead)
                let framesToRead = min(chunkFrames, remaining)
                try file.read(into: buffer, frameCount: framesToRead)

                let frameLength = Int(buffer.frameLength)
                guard frameLength > 0 else { break }

                appendEnvelopeSamples(from: buffer, frameLength: frameLength, to: &envelopes)
                framesRead += AVAudioFramePosition(frameLength)
            }

            return estimateBpm(from: envelopes, sampleRate: sampleRate)
        } catch {
            return nil
        }
    }

    private func appendEnvelopeSamples(
        from buffer: AVAudioPCMBuffer,
        frameLength: Int,
        to envelopes: inout [Double]
    ) {
        guard let channelData = buffer.floatChannelData else { return }
        let channelCount = max(1, Int(buffer.format.channelCount))

        var offset = 0
        while offset < frameLength {
            let end = min(offset + hopSize, frameLength)
            let frameCount = max(1, end - offset)
            var sum = 0.0

            for channel in 0..<channelCount {
                let samples = channelData[channel]
                for index in offset..<end {
                    sum += Double(abs(samples[index]))
                }
            }

            envelopes.append(sum / Double(frameCount * channelCount))
            offset += hopSize
        }
    }

    private func estimateBpm(from envelopes: [Double], sampleRate: Double) -> TethrTempoEstimate? {
        guard envelopes.count > 24 else { return nil }

        let mean = envelopes.reduce(0, +) / Double(envelopes.count)
        let normalized = envelopes.map { max(0, $0 - mean) }
        let onsets = zip(normalized.dropFirst(), normalized).map { current, previous in
            max(0, current - previous)
        }

        guard onsets.contains(where: { $0 > 0 }) else { return nil }

        let hopDuration = Double(hopSize) / sampleRate
        let minLag = max(1, Int((60 / maximumBpm) / hopDuration))
        let maxLag = min(onsets.count - 1, Int((60 / minimumBpm) / hopDuration))
        guard minLag < maxLag else { return nil }

        var scores = [Double](repeating: 0, count: maxLag + 1)
        var bestLag = minLag
        var bestScore = 0.0
        var scoreSum = 0.0
        var scoreCount = 0

        for lag in minLag...maxLag {
            var score = 0.0
            for index in lag..<onsets.count {
                score += onsets[index] * onsets[index - lag]
            }

            scores[lag] = score
            scoreSum += score
            scoreCount += 1

            if score > bestScore {
                bestScore = score
                bestLag = lag
            }
        }

        guard bestScore > 0, scoreCount > 0 else { return nil }

        // The integer peak is quantized to whole hops; at a 2048-sample hop the
        // BPM grid is coarse (e.g. 117.5 vs 129 around 120 BPM). Refine the peak
        // to a fractional lag via parabolic interpolation across its neighbors.
        let refinedLag = interpolatedPeakLag(scores: scores, peak: bestLag, minLag: minLag, maxLag: maxLag)

        let bpm = 60 / (refinedLag * hopDuration)
        let averageScore = max(scoreSum / Double(scoreCount), 0.000_001)
        let contrast = bestScore / averageScore
        let confidence = min(0.92, max(0.38, 0.34 + contrast * 0.08))

        return TethrTempoEstimate(
            bpm: min(max(bpm, minimumBpm), maximumBpm),
            confidence: confidence
        )
    }

    /// Parabolic peak interpolation: fits a parabola through the score at the
    /// integer peak and its two neighbors, returning the sub-sample lag of the
    /// true maximum. Falls back to the integer lag at array boundaries.
    private func interpolatedPeakLag(
        scores: [Double],
        peak: Int,
        minLag: Int,
        maxLag: Int
    ) -> Double {
        guard peak > minLag, peak < maxLag else { return Double(peak) }

        let previous = scores[peak - 1]
        let center = scores[peak]
        let next = scores[peak + 1]

        let denominator = previous - 2 * center + next
        guard denominator != 0 else { return Double(peak) }

        // offset in [-0.5, 0.5] toward the higher neighbor.
        let offset = 0.5 * (previous - next) / denominator
        guard offset.isFinite else { return Double(peak) }

        return Double(peak) + min(0.5, max(-0.5, offset))
    }

    private func fallbackBpm(for duration: TimeInterval) -> Double {
        let likelyBeatCounts = [64, 96, 128, 160, 192, 224, 256, 320, 384, 448]
        let candidates = likelyBeatCounts
            .map { Double($0) * 60 / duration }
            .filter { minimumBpm...maximumBpm ~= $0 }

        return candidates.min { abs($0 - 120) < abs($1 - 120) } ?? 120
    }
}
