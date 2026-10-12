package com.cacaosd.networkinspector.transport

import com.cacaosd.networkinspector.protocol.DEFAULT_INSPECTOR_PORT
import com.cacaosd.networkinspector.protocol.HelloPayload

fun NetworkInspector.install(
    appName: String,
    appVersion: String,
    configuration: NetworkInspectorConfig = NetworkInspectorConfig(port = DEFAULT_INSPECTOR_PORT)
) {
    val osName = System.getProperty("os.name")
    val osVersion = System.getProperty("os.version")
    val osArch = System.getProperty("os.arch")

    NetworkInspector.install(
        helloPayload = HelloPayload(
            deviceName = "$osName - $osArch",
            osVersion = osVersion,
            appName = appName,
            appVersion = appVersion
        ),
        configuration = configuration,
    )
}