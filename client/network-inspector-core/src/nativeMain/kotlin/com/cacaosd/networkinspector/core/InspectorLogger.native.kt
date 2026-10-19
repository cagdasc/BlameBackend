package com.cacaosd.networkinspector.core

internal actual fun logInspectorError(message: String, error: Throwable) {
    println("$message: $error")
}
