import Foundation

enum Severity: String, Codable, CaseIterable, Comparable {
    case low, medium, high, critical

    /// Higher is more severe, so the lists can sort worst first.
    var rank: Int {
        switch self {
        case .low: return 0
        case .medium: return 1
        case .high: return 2
        case .critical: return 3
        }
    }

    static func < (lhs: Severity, rhs: Severity) -> Bool { lhs.rank < rhs.rank }
}

struct Finding: Codable, Identifiable, Hashable {
    let id: String
    let integrationId: String
    let monitorName: String
    let kind: String
    let severity: Severity
    let status: String
    let observedAt: String
    let error: String?
}

struct MonitorStatus: Codable, Identifiable, Hashable {
    struct LastRun: Codable, Hashable {
        let state: String
    }

    let monitorId: String
    let name: String
    let integrationId: String
    let integrationName: String
    let severity: Severity
    let enabled: Bool
    let last: LastRun?

    // Monitor ids are unique only within an integration, so the identity includes it.
    var id: String { integrationId + "/" + monitorId }

    enum CodingKeys: String, CodingKey {
        case monitorId = "id"
        case name, integrationId, integrationName, severity, enabled, last
    }

    var stateLabel: String {
        if !enabled { return "disabled" }
        return last?.state ?? "never run"
    }
}

struct Group: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String
    let owner: String?
    let openIssues: Int
    let worstSeverity: Severity?
    let members: [MonitorStatus]
}

struct WhoAmI: Codable {
    let user: String
    let approver: Bool
}
