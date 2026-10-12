package com.cacaosd.networkinspector.transport

import com.cacaosd.networkinspector.core.logInspectorError
import com.cacaosd.networkinspector.protocol.HelloPayload
import com.cacaosd.networkinspector.protocol.MessageType
import com.cacaosd.networkinspector.protocol.WireEnvelope
import io.ktor.network.selector.SelectorManager
import io.ktor.network.sockets.InetSocketAddress
import io.ktor.network.sockets.Socket
import io.ktor.network.sockets.aSocket
import io.ktor.network.sockets.openWriteChannel
import io.ktor.utils.io.writeStringUtf8
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlin.time.Clock
import kotlin.time.Duration.Companion.milliseconds

/**
 * Outgoing TCP client. Connects to the inspector server and reconnects when it becomes available.
 */
class InspectorClient(
    private val host: String = "127.0.0.1",
    private val port: Int,
    private val helloPayload: HelloPayload,
    maxQueueSize: Int = 500
) {
    private val isRunning = MutableStateFlow(false)
    private val activeSocket = MutableStateFlow<Socket?>(null)
    private val queue = Channel<String>(maxQueueSize, BufferOverflow.DROP_OLDEST)
    private var scope: CoroutineScope? = null
    private var workerJob: Job? = null

    fun start() {
        if (isRunning.compareAndSet(expect = false, update = true)) {
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            workerJob = scope?.launch { runLoop() }
        }
    }

    private suspend fun runLoop() {
        val selectorManager = SelectorManager(Dispatchers.Default)
        try {
            while (isRunning.value) {
                var socket: Socket? = null
                try {
                    socket = aSocket(selectorManager)
                        .tcp()
                        .connect(InetSocketAddress(host, port))
                    activeSocket.value = socket

                    val output = socket.openWriteChannel(autoFlush = false)
                    val helloEnvelope = WireEnvelope(
                        type = MessageType.HELLO,
                        timestamp = Clock.System.now().toEpochMilliseconds(),
                        payloadJson = Json.encodeToString(helloPayload)
                    )
                    output.writeStringUtf8("${Json.encodeToString(helloEnvelope)}\n")
                    output.flush()

                    while (isRunning.value) {
                        output.writeStringUtf8("${queue.receive()}\n")
                        output.flush()
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    if (isRunning.value) {
                        logInspectorError("Inspector connection failed; retrying in 3 seconds", error)
                        delay(3000.milliseconds)
                    }
                } finally {
                    if (socket != null) {
                        activeSocket.compareAndSet(socket, null)
                        socket.close()
                    }
                }
            }
        } finally {
            selectorManager.close()
        }
    }

    /**
     * Non-blocking send: if the queue is full, the oldest event is discarded.
     */
    fun sendEvent(jsonLine: String) {
        if (isRunning.value) {
            queue.trySend(jsonLine)
        }
    }

    fun stop() {
        if (isRunning.compareAndSet(expect = true, update = false)) {
            activeSocket.value?.close()
            workerJob?.cancel()
            scope?.cancel()
            workerJob = null
            scope = null
            while (queue.tryReceive().isSuccess) Unit
        }
    }
}
