import Foundation

enum Config {
    /// Address of the deployed dashboard server. Use https in production.
    static let baseURL = URL(string: "https://monitor.example.com")!

    /// Cookie names the server may use for the session (see src/http/auth-routes.ts).
    static let sessionCookieNames = ["__Host-im_session", "im_session"]
}
