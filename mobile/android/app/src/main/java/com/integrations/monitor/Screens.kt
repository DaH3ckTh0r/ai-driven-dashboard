package com.integrations.monitor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Signed-in screen: a tab for open issues and a tab for groups. */
@Composable
fun DashboardApp(store: SessionStore, cookie: String, onSignOut: () -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    val api = remember(cookie) { Api(cookie) }
    val expired: () -> Unit = {
        store.clear()
        onSignOut()
    }

    Column(Modifier.fillMaxWidth()) {
        TabRow(selectedTabIndex = tab) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Issues") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Groups") })
        }
        if (tab == 0) IssuesScreen(api, expired) else GroupsScreen(api, expired)
    }
}

@Composable
fun IssuesScreen(api: Api, onExpired: () -> Unit) {
    var findings by remember { mutableStateOf<List<Finding>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun refresh() {
        scope.launch {
            loading = true
            try {
                findings = api.findings().sortedByDescending { it.severity.rank }
                error = null
            } catch (e: SignedOutException) {
                onExpired()
            } catch (e: Exception) {
                error = e.message
            } finally {
                loading = false
            }
        }
    }
    LaunchedEffect(api) { refresh() }

    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = { refresh() }, enabled = !loading) { Text(if (loading) "Loading…" else "Refresh") }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (findings.isEmpty() && !loading && error == null) Text("No open issues")
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(findings) { finding ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(finding.monitorName, style = MaterialTheme.typography.titleMedium)
                            Spacer(Modifier.weight(1f))
                            SeverityLabel(finding.severity)
                        }
                        Text(finding.integrationId, style = MaterialTheme.typography.bodySmall)
                        finding.error?.let {
                            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun GroupsScreen(api: Api, onExpired: () -> Unit) {
    var groups by remember { mutableStateOf<List<Group>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun refresh() {
        scope.launch {
            loading = true
            try {
                groups = api.groups()
                error = null
            } catch (e: SignedOutException) {
                onExpired()
            } catch (e: Exception) {
                error = e.message
            } finally {
                loading = false
            }
        }
    }
    LaunchedEffect(api) { refresh() }

    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = { refresh() }, enabled = !loading) { Text(if (loading) "Loading…" else "Refresh") }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(groups) { group ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(group.name, style = MaterialTheme.typography.titleMedium)
                            Spacer(Modifier.weight(1f))
                            group.worstSeverity?.let { SeverityLabel(it) }
                        }
                        if (group.description.isNotBlank()) {
                            Text(group.description, style = MaterialTheme.typography.bodySmall)
                        }
                        Text(
                            if (group.openIssues > 0) "${group.openIssues} open" else "No open issues",
                            color = if (group.openIssues > 0) Color(0xFFEF6C00) else Color(0xFF2E7D32),
                        )
                        HorizontalDivider(Modifier.padding(vertical = 8.dp))
                        group.members.forEach { member ->
                            Row {
                                Text(member.name)
                                Spacer(Modifier.weight(1f))
                                Text(member.stateLabel, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SeverityLabel(severity: Severity) {
    val color = when (severity) {
        Severity.low -> Color(0xFF1565C0)
        Severity.medium -> Color(0xFFB28704)
        Severity.high -> Color(0xFFEF6C00)
        Severity.critical -> Color(0xFFC62828)
    }
    Text(severity.name.replaceFirstChar { it.uppercase() }, color = color, style = MaterialTheme.typography.labelLarge)
}
