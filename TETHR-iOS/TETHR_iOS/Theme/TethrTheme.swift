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
