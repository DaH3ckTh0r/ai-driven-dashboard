package com.integrations.monitor

import kotlinx.serialization.Serializable

@Serializable
enum class Severity(val rank: Int) {
    low(0), medium(1), high(2), critical(3)
}

@Serializable
data class Finding(
    val id: String,
    val integrationId: String,
    val monitorName: String,
    val kind: String,
    val severity: Severity,
    val status: String,
    val observedAt: String,
    val error: String? = null,
)

@Serializable
data class LastRun(val state: String)

@Serializable
data class MonitorStatus(
    val id: String,
    val name: String,
    val integrationId: String,
    val integrationName: String,
    val severity: Severity,
    val enabled: Boolean,
    val last: LastRun? = null,
) {
    val stateLabel: String
        get() = if (!enabled) "disabled" else last?.state ?: "never run"
}

@Serializable
data class Group(
    val id: String,
    val name: String,
    val description: String,
    val owner: String? = null,
    val openIssues: Int,
    val worstSeverity: Severity? = null,
    val members: List<MonitorStatus>,
)

@Serializable
data class WhoAmI(val user: String, val approver: Boolean)
