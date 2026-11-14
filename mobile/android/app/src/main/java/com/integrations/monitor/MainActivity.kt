package com.integrations.monitor

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = SessionStore(applicationContext)

        setContent {
            MaterialTheme {
                Surface(Modifier) {
                    var cookie by remember { mutableStateOf(store.load()) }
                    val current = cookie
                    if (current == null) {
                        LoginScreen(onSignedIn = { header ->
                            store.save(header)
                            cookie = header
                        })
                    } else {
                        DashboardApp(store, current, onSignOut = { cookie = null })
                    }
                }
            }
        }
    }
}
