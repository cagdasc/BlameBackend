package com.cacaosd.networkinspector.core

import android.util.Log

internal actual fun logInspectorError(message: String, error: Throwable) {
    Log.e("NetworkInspector", message, error)
}
