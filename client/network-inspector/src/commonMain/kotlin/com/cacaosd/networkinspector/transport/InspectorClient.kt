package com.cacaosd.networkinspector.transport

import com.cacaosd.networkinspector.protocol.HelloPayload
import com.cacaosd.networkinspector.protocol.MessageType
import com.cacaosd.networkinspector.protocol.WireEnvelope
import kotlinx.serialization.json.Json
import java.io.BufferedWriter
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Outgoing TCP client. Connects to BlameBackend server on 127.0.0.1:port.
 * Automatically reconnects when BlameBackend starts up.
 */
class InspectorClient(
    private val host: String = "127.0.0.1",
    private val port: Int,
    private val helloPayload: HelloPayload,
    private val maxQueueSize: Int = 500
) {
    private val isRunning = AtomicBoolean(false)
    private val queue = LinkedBlockingQueue<String>(maxQueueSize)
    private var workerThread: Thread? = null

    fun start() {
        if (isRunning.compareAndSet(false, true)) {
            workerThread = thread(name = "inspector-client-worker", isDaemon = true) {
                runLoop()
            }
        }
    }

    private fun runLoop() {
        while (isRunning.get()) {
            var socket: Socket? = null
            var writer: BufferedWriter? = null

            try {
                // 1. Attempt connection to host server
                socket = Socket()
                socket.tcpNoDelay = true
                socket.connect(InetSocketAddress(host, port), 2000)

                writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream(), Charsets.UTF_8))

                // 2. Send HELLO handshake
                val helloEnvelope = WireEnvelope(
                    type = MessageType.HELLO,
                    timestamp = System.currentTimeMillis(),
                    payloadJson = Json.encodeToString(helloPayload)
                )
                writer.write(Json.encodeToString(helloEnvelope))
                writer.newLine()
                writer.flush()

                // 3. Continuously send queued events
                while (isRunning.get()) {
                    val message = queue.take() // Blocks until an event arrives
                    writer.write(message)
                    writer.newLine()
                    writer.flush()
                }

            } catch (e: Exception) {
                // Server is not running or disconnected; sleep 3s before retry
                runCatching { writer?.close() }
                runCatching { socket?.close() }

                try {
                    Thread.sleep(3000)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }
    }

    /**
     * Non-blocking send: if queue is full (e.g. inspector not running), drop oldest.
     */
    fun sendEvent(jsonLine: String) {
        if (!isRunning.get()) return
        if (queue.remainingCapacity() == 0) {
            queue.poll() // Drop oldest to prevent memory leaks
        }
        queue.offer(jsonLine)
    }

    fun stop() {
        if (isRunning.compareAndSet(true, false)) {
            workerThread?.interrupt()
            workerThread = null
            queue.clear()
        }
    }
}
