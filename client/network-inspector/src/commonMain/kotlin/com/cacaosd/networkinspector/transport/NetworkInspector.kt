package com.cacaosd.networkinspector.transport

import com.cacaosd.networkinspector.core.HeaderRedactor
import com.cacaosd.networkinspector.core.InspectorEventBus
import com.cacaosd.networkinspector.core.logInspectorError
import com.cacaosd.networkinspector.protocol.DEFAULT_INSPECTOR_PORT
import com.cacaosd.networkinspector.protocol.HelloPayload
import com.cacaosd.networkinspector.protocol.MessageType
import com.cacaosd.networkinspector.protocol.WireEnvelope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlin.time.Clock

/**
 * Network Inspector facade.
 *
 * Captures, transports, and inspects HTTP traffic without affecting application semantics.
 * Completely inert/no-op in release builds or when the desktop tool is disconnected.
 */
object NetworkInspector {
    private val isStarted = MutableStateFlow(false)
    private var config: NetworkInspectorConfig = NetworkInspectorConfig()
    private var scope: CoroutineScope? = null
    private var client: InspectorClient? = null

    fun install(
        helloPayload: HelloPayload,
        configuration: NetworkInspectorConfig = NetworkInspectorConfig()
    ) {
        if (isStarted.compareAndSet(expect = false, update = true)) {
            this.config = configuration
            InspectorEventBus.configure(
                configuration.redactor,
                configuration.maxBodySizeBytes,
                configuration.maxQueueSize,
            )
            scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
            startInternal(helloPayload)
        }
    }

    private fun startInternal(helloPayload: HelloPayload) {
        client = InspectorClient(
            host = "127.0.0.1",
            port = config.port,
            helloPayload = helloPayload,
            maxQueueSize = config.maxQueueSize
        ).apply { start() }

        scope?.launch(start = CoroutineStart.UNDISPATCHED) {
            InspectorEventBus.events.collect { event ->
                try {
                    val json = Json.encodeToString(event)
                    val envelope = WireEnvelope(
                        type = MessageType.NETWORK_EVENT,
                        timestamp = Clock.System.now().toEpochMilliseconds(),
                        payloadJson = json
                    )
                    client?.sendEvent(Json.encodeToString(envelope))
                } catch (error: Exception) {
                    logInspectorError("Error dispatching inspector event", error)
                }
            }
        }
    }

    fun stop() {
        if (isStarted.compareAndSet(expect = true, update = false)) {
            client?.stop()
            client = null
            scope?.cancel()
            scope = null
        }
    }
}

data class NetworkInspectorConfig(
    val port: Int = DEFAULT_INSPECTOR_PORT,
    val maxBodySizeBytes: Long = 64 * 1024L, // 64 KB
    val maxQueueSize: Int = 500,
    val redactor: HeaderRedactor = HeaderRedactor()
) {
    init {
        require(maxQueueSize > 0) { "maxQueueSize must be greater than zero" }
    }
}
