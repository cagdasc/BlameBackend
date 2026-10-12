package com.cacaosd.networkinspector.core

import dev.shivathapaa.logger.api.Log

internal actual fun logInspectorError(message: String, error: Throwable) {
    Log.e(message, throwable = error)
}
