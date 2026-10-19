package com.cacaosd.networkinspector.transport

import android.content.Context
import android.os.Build
import com.cacaosd.networkinspector.protocol.HelloPayload

fun NetworkInspector.install(
    context: Context,
    configuration: NetworkInspectorConfig = NetworkInspectorConfig()
) {
    val packageInfo = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0)
    }.getOrNull()

    NetworkInspector.install(
        HelloPayload(
            deviceName = "${Build.MANUFACTURER} ${Build.MODEL}",
            osVersion = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
            appName = context.packageName,
            appVersion = packageInfo?.versionName ?: "debug"
        ),
        configuration,
    )
}