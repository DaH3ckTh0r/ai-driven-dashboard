package com.integrations.monitor

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import java.net.URI

/**
 * Shows the server's sign-in pages. When the callback lands back on the dashboard,
 * the session cookie is copied into the encrypted store and [onSignedIn] runs.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LoginScreen(onSignedIn: (String) -> Unit) {
    val base = BuildConfig.BASE_URL.trimEnd('/')
    val baseHost = URI(base).host

    AndroidView(
        modifier = Modifier,
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String) {
                        val uri = URI(url)
                        if (uri.host != baseHost || uri.path.orEmpty().startsWith("/auth")) return

                        val cookies = CookieManager.getInstance().getCookie(base).orEmpty()
                        val session = cookies.split(";")
                            .map { it.trim() }
                            .filter { it.startsWith("__Host-im_session=") || it.startsWith("im_session=") }
                        if (session.isNotEmpty()) onSignedIn(session.joinToString("; "))
                    }
                }
                loadUrl("$base/auth/login")
            }
        },
    )
}
