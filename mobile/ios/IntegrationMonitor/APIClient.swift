import Foundation

enum APIError: Error, LocalizedError {
    case signedOut
    case server(status: Int)
    case transport(Error)

    var errorDescription: String? {
        switch self {
        case .signedOut: return "Your session has ended. Sign in again."
        case .server(let status): return "The server answered with status \(status)."
        case .transport(let error): return error.localizedDescription
        }
    }
}

/// Read-only client for the dashboard API. Sends the session cookie with every request.
struct APIClient {
    let baseURL: URL
    let cookieHeader: String

    init(baseURL: URL = Config.baseURL, cookieHeader: String) {
        self.baseURL = baseURL
        self.cookieHeader = cookieHeader
    }

    func findings() async throws -> [Finding] {
        try await get("/api/findings?status=open")
    }

    func groups() async throws -> [Group] {
        try await get("/api/groups")
    }

    func whoAmI() async throws -> WhoAmI {
        try await get("/api/whoami")
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.server(status: -1)
        }
        var request = URLRequest(url: url)
        request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.server(status: -1)
        }
        if http.statusCode == 401 { throw APIError.signedOut }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.server(status: http.statusCode)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
