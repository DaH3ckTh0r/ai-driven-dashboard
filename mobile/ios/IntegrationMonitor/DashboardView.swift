import SwiftUI

struct DashboardView: View {
    @ObservedObject var session: SessionModel

    var body: some View {
        TabView {
            IssuesView(session: session)
                .tabItem { Label("Issues", systemImage: "exclamationmark.triangle") }
            GroupsView(session: session)
                .tabItem { Label("Groups", systemImage: "square.stack.3d.up") }
        }
    }
}

/// Runs a request and turns an expired session into a sign-out, so the sign-in screen appears again.
@MainActor
private func load<T>(_ session: SessionModel, _ fetch: (APIClient) async throws -> T) async -> (T?, String?) {
    guard let header = session.cookieHeader else { return (nil, nil) }
    do {
        return (try await fetch(APIClient(cookieHeader: header)), nil)
    } catch APIError.signedOut {
        session.signOut()
        return (nil, nil)
    } catch {
        return (nil, error.localizedDescription)
    }
}

struct IssuesView: View {
    @ObservedObject var session: SessionModel
    @State private var findings: [Finding] = []
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).foregroundStyle(.red) }
                if findings.isEmpty && !loading && error == nil {
                    Text("No open issues").foregroundStyle(.secondary)
                }
                ForEach(findings.sorted { $0.severity > $1.severity }) { finding in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(finding.monitorName).font(.headline)
                            Spacer()
                            SeverityBadge(severity: finding.severity)
                        }
                        Text(finding.integrationId).font(.caption).foregroundStyle(.secondary)
                        if let problem = finding.error {
                            Text(problem).font(.caption).foregroundStyle(.red)
                        }
                    }
                }
            }
            .navigationTitle("Open issues")
            .refreshable { await refresh() }
            .task { await refresh() }
        }
    }

    private func refresh() async {
        loading = true
        defer { loading = false }
        let (result, message) = await load(session) { try await $0.findings() }
        if let result { findings = result }
        error = message
    }
}

struct GroupsView: View {
    @ObservedObject var session: SessionModel
    @State private var groups: [Group] = []
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).foregroundStyle(.red) }
                ForEach(groups) { group in
                    Section {
                        if !group.description.isEmpty {
                            Text(group.description).font(.caption).foregroundStyle(.secondary)
                        }
                        HStack {
                            if group.openIssues > 0 {
                                Text("\(group.openIssues) open").foregroundStyle(.orange)
                            } else {
                                Text("No open issues").foregroundStyle(.green)
                            }
                            Spacer()
                            if let worst = group.worstSeverity { SeverityBadge(severity: worst) }
                        }
                        ForEach(group.members) { member in
                            HStack {
                                Text(member.name)
                                Spacer()
                                Text(member.stateLabel).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    } header: {
                        Text(group.name)
                    }
                }
            }
            .navigationTitle("Groups")
            .refreshable { await refresh() }
            .task { await refresh() }
        }
    }

    private func refresh() async {
        let (result, message) = await load(session) { try await $0.groups() }
        if let result { groups = result }
        error = message
    }
}

struct SeverityBadge: View {
    let severity: Severity

    var body: some View {
        Text(severity.rawValue.capitalized)
            .font(.caption.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(color.opacity(0.2), in: Capsule())
            .foregroundStyle(color)
    }

    private var color: Color {
        switch severity {
        case .low: return .blue
        case .medium: return .yellow
        case .high: return .orange
        case .critical: return .red
        }
    }
}
