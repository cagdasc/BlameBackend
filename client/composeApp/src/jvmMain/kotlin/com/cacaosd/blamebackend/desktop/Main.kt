package com.cacaosd.blamebackend.desktop

import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import com.cacaosd.blamebackend.App
import com.cacaosd.networkinspector.transport.NetworkInspector
import com.cacaosd.networkinspector.transport.install

fun main() {
    try {
        NetworkInspector.install(
            appName = "BlameBackend-DesktopClient",
            appVersion = "0.0.1"
        )
        application {
            Window(
                onCloseRequest = ::exitApplication,
                title = "BlameBackend",
            ) {
                App()
            }
        }
    } finally {
        NetworkInspector.stop()
    }

}
