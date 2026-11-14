package com.integrations.monitor

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL

class SignedOutException : Exception("Your session has ended. Sign in again.")

/** Read-only client for the dashboard API. Sends the session cookie with every request. */
class Api(private val cookieHeader: String, private val baseUrl: String = BuildConfig.BASE_URL) {

    private val json = Json { ignoreUnknownKeys = true }

    suspend fun findings(): List<Finding> = withContext(Dispatchers.IO) {
        json.decodeFromString(ListSerializer(Finding.serializer()), get("/api/findings?status=open"))
    }

    suspend fun groups(): List<Group> = withContext(Dispatchers.IO) {
        json.decodeFromString(ListSerializer(Group.serializer()), get("/api/groups"))
    }

    suspend fun whoAmI(): WhoAmI = withContext(Dispatchers.IO) {
        json.decodeFromString(WhoAmI.serializer(), get("/api/whoami"))
    }

    private fun get(path: String): String {
        val connection = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.setRequestProperty("Cookie", cookieHeader)
            connection.setRequestProperty("Accept", "application/json")
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000

            when (val status = connection.responseCode) {
                401 -> throw SignedOutException()
                in 200..299 -> return connection.inputStream.bufferedReader().use { it.readText() }
                else -> throw IllegalStateException("The server answered with status $status.")
            }
        } finally {
            connection.disconnect()
        }
    }
}
