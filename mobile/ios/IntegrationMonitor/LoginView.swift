import SwiftUI
import WebKit

/// Shows the server's sign-in pages. When the callback lands back on the dashboard,
/// the session cookie is copied into the Keychain and the view closes.
struct LoginView: UIViewRepresentable {
    let onSignedIn: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onSignedIn: onSignedIn) }

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero)
        view.navigationDelegate = context.coordinator
        view.load(URLRequest(url: Config.baseURL.appending(path: "auth/login")))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let onSignedIn: (String) -> Void

        init(onSignedIn: @escaping (String) -> Void) {
            self.onSignedIn = onSignedIn
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let url = webView.url,
                  url.host == Config.baseURL.host,
                  !url.path.hasPrefix("/auth") else { return }

            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                let session = cookies.filter { Config.sessionCookieNames.contains($0.name) }
                guard !session.isEmpty else { return }
                let header = session.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
                DispatchQueue.main.async { self.onSignedIn(header) }
            }
        }
    }
}
