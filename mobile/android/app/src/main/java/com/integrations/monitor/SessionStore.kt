package com.integrations.monitor

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Keeps the session cookie in EncryptedSharedPreferences, backed by the Android Keystore.
 *
 * Fallback if the sign-in cookie cannot be read from the WebView's CookieManager (it may hide
 * HttpOnly cookies on some Android versions): have the server return the session token in the
 * sign-in callback page body, and store that instead. Do not expose it to page scripts.
 */
class SessionStore(context: Context) {

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun load(): String? = prefs.getString(KEY, null)

    fun save(cookieHeader: String) {
        prefs.edit().putString(KEY, cookieHeader).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    private companion object {
        const val KEY = "cookie"
    }
}
