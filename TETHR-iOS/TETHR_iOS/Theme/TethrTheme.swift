import CoreText
import SwiftUI

enum TethrTheme {
    // Matte foundation — reference T.bg0..bg4
    static let bg0 = Color(red: 13 / 255, green: 13 / 255, blue: 15 / 255)
    static let bg1 = Color(red: 17 / 255, green: 17 / 255, blue: 19 / 255)
    static let bg2 = Color(red: 21 / 255, green: 21 / 255, blue: 24 / 255)
    static let bg3 = Color(red: 26 / 255, green: 26 / 255, blue: 30 / 255)
    static let bg4 = Color(red: 34 / 255, green: 34 / 255, blue: 40 / 255)

    // Cool neutrals — reference T.fg0..fg5
    static let fg0 = Color(red: 231 / 255, green: 236 / 255, blue: 246 / 255)
    static let fg1 = Color(red: 206 / 255, green: 214 / 255, blue: 232 / 255)
    static let fg2 = Color(red: 174 / 255, green: 184 / 255, blue: 205 / 255)
    static let fg3 = Color(red: 125 / 255, green: 135 / 255, blue: 155 / 255)
    static let fg4 = Color(red: 74 / 255, green: 82 / 255, blue: 99 / 255)
    static let fg5 = Color(red: 37 / 255, green: 42 / 255, blue: 54 / 255)

    // Spectral accents — reference suite canon
    static let cyan = Color(red: 0 / 255, green: 215 / 255, blue: 212 / 255)
    static let cyanHi = Color(red: 22 / 255, green: 242 / 255, blue: 234 / 255)
    static let cyanLo = Color(red: 0 / 255, green: 158 / 255, blue: 166 / 255)
    static let teal = cyan
    static let tealHi = cyanHi
    static let tealLo = Color(red: 0 / 255, green: 184 / 255, blue: 200 / 255)
    static let aqua = Color(red: 0 / 255, green: 169 / 255, blue: 255 / 255)
    static let peri = Color(red: 79 / 255, green: 99 / 255, blue: 255 / 255)
    static let periHi = Color(red: 110 / 255, green: 126 / 255, blue: 255 / 255)
    static let periLo = Color(red: 47 / 255, green: 62 / 255, blue: 168 / 255)
    static let violet = Color(red: 143 / 255, green: 92 / 255, blue: 255 / 255)
    static let magenta = Color(red: 166 / 255, green: 77 / 255, blue: 255 / 255)
    static let magentaHi = Color(red: 190 / 255, green: 125 / 255, blue: 255 / 255)
    static let magentaLo = Color(red: 108 / 255, green: 46 / 255, blue: 179 / 255)
    static let electricPurple = Color(red: 192 / 255, green: 61 / 255, blue: 255 / 255)
    static let danger = Color(red: 242 / 255, green: 107 / 255, blue: 122 / 255)

    // Hairlines — reference T.line1..line3
    static let line1 = fg2.opacity(0.08)
    static let line2 = fg2.opacity(0.22)
    static let line3 = fg0.opacity(0.44)

    // Legacy aliases — kept so existing call sites keep compiling
    static let matteBlack = bg0
    static let panel = bg1
    static let panelRaised = bg2
    static let text = fg0
    static let textMid = fg2
    static let textLow = fg3
    static let textDim = fg4
    static let textGhost = fg5
    static let border = line1
    static let borderStrong = line2
    static let cyanHigh = cyanHi
    static let indigo = peri
    static let purple = magenta

    private static let fontResourceNames = [
        "NIGHTSHAPE-UI-Bold",
        "NIGHTSHAPE-UI-Regular",
        "NIGHTSHAPE-UI-Light"
    ]

    static func color(for tone: TethrSignalTone) -> Color {
        switch tone {
        case .cyan:
            return cyan
        case .indigo:
            return indigo
        case .purple:
            return purple
        case .muted:
            return textLow
        }
    }

    static func registerFonts() {
        for fontName in fontResourceNames {
            guard let fontURL = Bundle.main.url(
                forResource: fontName,
                withExtension: "ttf",
                subdirectory: "Fonts"
            ) ?? Bundle.main.url(
                forResource: fontName,
                withExtension: "ttf"
            ) else {
                continue
            }

            _ = CTFontManagerRegisterFontsForURL(fontURL as CFURL, .process, nil)
        }
    }
}

enum TethrFont {
    static func display(_ size: CGFloat) -> Font {
        .custom("NIGHTSHAPEUI-Bold", size: size)
    }

    static func bold(_ size: CGFloat) -> Font {
        .custom("NIGHTSHAPEUI-Bold", size: size)
    }

    static func regular(_ size: CGFloat) -> Font {
        .custom("NIGHTSHAPEUI-Regular", size: size)
    }

    static func medium(_ size: CGFloat) -> Font {
        .custom("NIGHTSHAPEUI-Regular", size: size)
    }

    static func light(_ size: CGFloat) -> Font {
        .custom("NIGHTSHAPEUI-Light", size: size)
    }
}

struct TethrPanelModifier: ViewModifier {
    var isRaised = false

    func body(content: Content) -> some View {
        content
            .background(isRaised ? TethrTheme.panelRaised : TethrTheme.panel)
            .clipShape(Rectangle())
            .overlay(
                Rectangle()
                    .stroke(isRaised ? TethrTheme.borderStrong : TethrTheme.border, lineWidth: 1)
            )
    }
}

extension View {
    func tethrPanel(isRaised: Bool = false) -> some View {
        modifier(TethrPanelModifier(isRaised: isRaised))
    }
}

struct TethrSignalButtonStyle: ButtonStyle {
    var tone: TethrSignalTone = .cyan

    func makeBody(configuration: Configuration) -> some View {
        let color = TethrTheme.color(for: tone)

        configuration.label
            .font(TethrFont.bold(13))
            .textCase(.uppercase)
            .tracking(1.2)
            .foregroundStyle(color)
            .frame(minHeight: 46)
            .padding(.horizontal, 14)
            .background(
                Rectangle()
                    .fill(color.opacity(configuration.isPressed ? 0.12 : 0.055))
            )
            .overlay(
                Rectangle()
                    .stroke(color.opacity(configuration.isPressed ? 0.70 : 0.48), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
    }
}

// MARK: - NIGHTSHAPE shared chrome
//
// These mirror the conventions in nightshape-drumkit-ios so TETHR reads as the
// same product family: L-bracket corner marks, square accent-stroked controls,
// a `+ LABEL ›` workstation action bar, and a thin footer status strip.

/// L-shaped corner brackets drawn just inside a panel's edges — the canonical
/// NIGHTSHAPE panel framing (see DRUMKIT `panelCornerMarks`).
struct TethrCornerMarks: View {
    var color: Color = TethrTheme.cyan
    var opacity: Double = 0.34
    var inset: CGFloat = 1
    var length: CGFloat = 13

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            Path { path in
                path.move(to: CGPoint(x: inset, y: length))
                path.addLine(to: CGPoint(x: inset, y: inset))
                path.addLine(to: CGPoint(x: length, y: inset))

                path.move(to: CGPoint(x: w - length, y: inset))
                path.addLine(to: CGPoint(x: w - inset, y: inset))
                path.addLine(to: CGPoint(x: w - inset, y: length))

                path.move(to: CGPoint(x: inset, y: h - length))
                path.addLine(to: CGPoint(x: inset, y: h - inset))
                path.addLine(to: CGPoint(x: length, y: h - inset))

                path.move(to: CGPoint(x: w - length, y: h - inset))
                path.addLine(to: CGPoint(x: w - inset, y: h - inset))
                path.addLine(to: CGPoint(x: w - inset, y: h - length))
            }
            .stroke(color.opacity(opacity), style: StrokeStyle(lineWidth: 1, lineCap: .square, lineJoin: .miter))
        }
        .allowsHitTesting(false)
    }
}

/// Workstation action control: `＋  LABEL  ›`, accent-stroked with a lit bottom
/// edge. Used for IMPORT / EXPORT so they read as console controls, not buttons.
struct TethrActionControl: View {
    let label: String
    var accent: Color = TethrTheme.cyan
    var leadingGlyph: String = "+"
    var height: CGFloat = 44

    var body: some View {
        HStack(spacing: 0) {
            Text(leadingGlyph)
                .font(TethrFont.bold(13))
                .foregroundStyle(accent.opacity(0.78))
                .frame(width: 26)

            Spacer(minLength: 6)

            Text(label)
                .font(TethrFont.bold(9.5))
                .tracking(2.5)
                .textCase(.uppercase)
                .foregroundStyle(accent.opacity(0.84))
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            Spacer(minLength: 6)

            Text("\u{203A}")
                .font(TethrFont.bold(16))
                .foregroundStyle(accent.opacity(0.78))
                .frame(width: 26)
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .background(TethrTheme.bg2.opacity(0.54))
        .overlay(Rectangle().stroke(accent.opacity(0.72), lineWidth: 1.25))
        .overlay(alignment: .bottom) {
            Rectangle().fill(accent.opacity(0.28)).frame(height: 1)
        }
    }
}

/// Square accent-stroked chrome control (DRUMKIT power/transport tile language).
struct TethrChromeButton<Label: View>: View {
    var accent: Color = TethrTheme.fg2
    var isActive: Bool = false
    let action: () -> Void
    @ViewBuilder var label: () -> Label

    var body: some View {
        Button(action: action) {
            label()
                .foregroundStyle(isActive ? accent : TethrTheme.fg1)
                .frame(width: 40, height: 40)
                .background(Color(red: 16 / 255, green: 16 / 255, blue: 22 / 255))
                .overlay(
                    Rectangle().stroke(
                        (isActive ? accent : TethrTheme.line2).opacity(isActive ? 0.62 : 1),
                        lineWidth: 1
                    )
                )
                .shadow(color: accent.opacity(isActive ? 0.35 : 0), radius: 5)
        }
        .buttonStyle(.plain)
    }
}

/// Thin footer status strip — the workstation chrome band (DRUMKIT footer).
struct TethrStatusStrip: View {
    var leading: String
    var trailing: String
    var leadingAccent: Color = TethrTheme.fg3
    var trailingAccent: Color = TethrTheme.fg3

    var body: some View {
        HStack {
            Text(leading)
                .font(TethrFont.medium(9))
                .tracking(3)
                .foregroundStyle(leadingAccent)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(trailing)
                .font(TethrFont.medium(9))
                .tracking(2.4)
                .foregroundStyle(trailingAccent)
                .lineLimit(1)
        }
        .padding(.horizontal, 20)
        .frame(height: 34)
        .frame(maxWidth: .infinity)
        .background(Color(red: 8 / 255, green: 8 / 255, blue: 10 / 255).opacity(0.82))
        .overlay(alignment: .top) {
            Rectangle().fill(TethrTheme.fg2.opacity(0.05)).frame(height: 1)
        }
    }
}

/// "BY NIGHTSHAPE" byline — the family signature beneath any wordmark.
struct TethrByline: View {
    var size: CGFloat = 9
    var opacity: Double = 0.62

    var body: some View {
        Text("BY NIGHTSHAPE")
            .font(TethrFont.medium(size))
            .tracking(size * 0.42)
            .foregroundStyle(Color.white.opacity(opacity))
            .accessibilityLabel("By Nightshape")
    }
}
