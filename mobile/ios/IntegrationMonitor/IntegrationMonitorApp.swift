import SwiftUI

@main
struct IntegrationMonitorApp: App {
    @StateObject private var session = SessionModel()

    var body: some Scene {
        WindowGroup {
            Group {
                if session.cookieHeader != nil {
                    DashboardView(session: session)
                } else {
                    SignInView(session: session)
                }
            }
        }
    }
}

/// Holds the signed-in state. The cookie comes from the Keychain at launch.
@MainActor
final class SessionModel: ObservableObject {
    @Published private(set) var cookieHeader: String? = SessionStore.load()

    func signIn(cookieHeader: String) {
        SessionStore.save(cookieHeader: cookieHeader)
        self.cookieHeader = cookieHeader
    }

    func signOut() {
        SessionStore.clear()
        cookieHeader = nil
    }
}

struct SignInView: View {
    @ObservedObject var session: SessionModel

    var body: some View {
        LoginView { header in
            session.signIn(cookieHeader: header)
        }
        .ignoresSafeArea()
    }
}
