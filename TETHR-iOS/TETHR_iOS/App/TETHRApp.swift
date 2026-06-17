import SwiftUI

@main
struct TETHRApp: App {
    @StateObject private var orientationLock = OrientationLockManager.shared

    init() {
        TethrTheme.registerFonts()
    }

    var body: some Scene {
        WindowGroup {
            TethrRootView()
                .environmentObject(orientationLock)
        }
    }
}

enum OrientationLock: String, CaseIterable, Equatable {
    case auto
    case portrait
    case landscape

    var next: OrientationLock {
        switch self {
        case .auto: return .portrait
        case .portrait: return .landscape
        case .landscape: return .auto
        }
    }

    var isLocked: Bool { self != .auto }
}

final class OrientationLockManager: ObservableObject {
    static let shared = OrientationLockManager()

    @Published private(set) var lock: OrientationLock = .auto

    var isLandscape: Bool { lock == .landscape }

    func cycle() {
        lock = lock.next
    }
}
