import SwiftUI

struct WaveformPlaceholderView: View {
    let isLoaded: Bool
    let playheadProgress: Double
    let sourceDuration: TimeInterval?
    let detectedBpm: Double?
    let targetBpm: Double
    let beatMarkers: [TethrBeatMarker]

    private let bars: [CGFloat] = [
        0.18, 0.32, 0.24, 0.54, 0.78, 0.36, 0.28, 0.46,
        0.66, 0.42, 0.22, 0.58, 0.84, 0.52, 0.34, 0.48,
        0.74, 0.62, 0.26, 0.38, 0.56, 0.88, 0.44, 0.30,
        0.68, 0.76, 0.40, 0.24, 0.50, 0.70, 0.60, 0.34,
        0.22, 0.46, 0.64, 0.82, 0.58, 0.36, 0.28, 0.52,
        0.72, 0.44, 0.32, 0.66, 0.86, 0.48, 0.30, 0.42,
        0.62, 0.78, 0.54, 0.24, 0.36, 0.56, 0.74, 0.40,
        0.26, 0.50, 0.68, 0.80, 0.46, 0.34, 0.58, 0.72
    ]

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                if isLoaded {
                    waveform(in: geometry.size)
                    beatCorrectionGhosts(in: geometry.size)

                    Rectangle()
                        .fill(TethrTheme.cyan)
                        .frame(width: 2)
                        .offset(x: CGFloat(max(0, min(1, playheadProgress))) * geometry.size.width)
                        .opacity(0.94)
                } else {
                    emptyState
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 22)
        }
        .tethrPanel(isRaised: true)
    }

    private func waveform(in size: CGSize) -> some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(bars.indices, id: \.self) { index in
                Rectangle()
                    .fill(barColor(for: index))
                    .frame(maxWidth: .infinity)
                    .frame(height: barHeight(for: index, in: size))
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Rectangle()
                .fill(TethrTheme.textGhost.opacity(0.62))
                .frame(width: 96, height: 1)

            Text("IMPORT AUDIO")
                .font(TethrFont.light(10))
                .tracking(2.4)
                .foregroundStyle(TethrTheme.textLow.opacity(0.44))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func beatCorrectionGhosts(in size: CGSize) -> some View {
        let duration = effectiveDuration
        let markers = Array(beatMarkers.prefix(72))

        return ZStack(alignment: .leading) {
            ForEach(markers) { marker in
                let detectedX = xPosition(for: marker.detectedTime, duration: duration, width: size.width)
                let correctedX = correctedXPosition(for: marker, duration: duration, width: size.width)
                let height = beatHeight(for: marker, in: size)
                let correctedColor = marker.beatIndex.isMultiple(of: 4) ? TethrTheme.purple : TethrTheme.cyan

                Path { path in
                    path.move(to: CGPoint(x: detectedX, y: size.height / 2))
                    path.addLine(to: CGPoint(x: correctedX, y: size.height / 2))
                }
                .stroke(
                    TethrTheme.textLow.opacity(0.16),
                    style: StrokeStyle(lineWidth: 1, lineCap: .butt, dash: [2, 4])
                )

                Rectangle()
                    .fill(TethrTheme.textLow.opacity(0.26))
                    .frame(width: 1, height: height * 0.78)
                    .position(x: detectedX, y: size.height / 2)

                Rectangle()
                    .fill(correctedColor.opacity(marker.beatIndex.isMultiple(of: 4) ? 0.74 : 0.82))
                    .frame(width: marker.beatIndex.isMultiple(of: 4) ? 2 : 1.5, height: height)
                    .position(x: correctedX, y: size.height / 2)
            }
        }
    }

    private func barHeight(for index: Int, in size: CGSize) -> CGFloat {
        let availableHeight = max(6, size.height - 48)
        return min(availableHeight, max(6, size.height * bars[index] * 0.56))
    }

    private func barColor(for index: Int) -> Color {
        if index % 11 == 0 {
            return TethrTheme.purple.opacity(0.38)
        }
        if index % 7 == 0 {
            return TethrTheme.indigo.opacity(0.38)
        }
        return TethrTheme.cyan.opacity(0.34)
    }

    private var effectiveDuration: TimeInterval {
        if let sourceDuration, sourceDuration.isFinite, sourceDuration > 0 {
            return sourceDuration
        }

        return max(1, beatMarkers.map(\.detectedTime).max() ?? 1)
    }

    private func correctedXPosition(
        for marker: TethrBeatMarker,
        duration: TimeInterval,
        width: CGFloat
    ) -> CGFloat {
        let bpm = max(1.0, targetBpm.isFinite ? targetBpm : (detectedBpm ?? 120))
        let correctedTime = Double(marker.beatIndex) * 60 / bpm
        return xPosition(for: correctedTime, duration: duration, width: width)
    }

    private func xPosition(
        for time: TimeInterval,
        duration: TimeInterval,
        width: CGFloat
    ) -> CGFloat {
        guard duration > 0 else { return 0 }
        let progress = min(1, max(0, time / duration))
        return CGFloat(progress) * width
    }

    private func beatHeight(for marker: TethrBeatMarker, in size: CGSize) -> CGFloat {
        let base = size.height * (marker.beatIndex.isMultiple(of: 4) ? 0.72 : 0.46)
        let confidenceLift = CGFloat(min(0.22, max(0, marker.confidence * 0.16)))
        return max(24, min(size.height - 20, base + size.height * confidenceLift))
    }
}

#Preview {
    WaveformPlaceholderView(
        isLoaded: true,
        playheadProgress: 0.34,
        sourceDuration: 44,
        detectedBpm: 120,
        targetBpm: 128,
        beatMarkers: (0..<48).map {
            TethrBeatMarker(
                beatIndex: $0,
                detectedTime: Double($0) * 0.5 + sin(Double($0)) * 0.035,
                confidence: 0.72
            )
        }
    )
        .frame(height: 190)
        .padding()
        .background(TethrTheme.matteBlack)
}
