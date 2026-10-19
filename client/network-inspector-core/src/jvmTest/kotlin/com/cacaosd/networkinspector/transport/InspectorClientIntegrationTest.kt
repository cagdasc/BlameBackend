package com.cacaosd.networkinspector.transport

import com.cacaosd.networkinspector.protocol.HelloPayload
import com.cacaosd.networkinspector.protocol.MessageType
import com.cacaosd.networkinspector.protocol.WireEnvelope
import kotlinx.serialization.json.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class InspectorClientIntegrationTest {
    @Test
    fun connectsSendsHelloAndStreamsQueuedEvents() {
        val server = ServerSocket(0)
        val receivedLines = java.util.concurrent.LinkedBlockingQueue<String>()
        val serverThread = thread(name = "inspector-client-test-server", isDaemon = true) {
            server.accept().use { socket ->
                val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
                receivedLines.put(reader.readLine())
                receivedLines.put(reader.readLine())
            }
        }
        val hello = HelloPayload(
            deviceName = "Test device",
            osVersion = "test",
            appName = "InspectorClientTest",
            appVersion = "1",
        )
        val client = InspectorClient(
            host = "127.0.0.1",
            port = server.localPort,
            helloPayload = hello,
        )

        try {
            client.start()
            client.sendEvent("""{"type":"NETWORK_EVENT"}""")

            val helloLine = receivedLines.poll(5, java.util.concurrent.TimeUnit.SECONDS)
            val eventLine = receivedLines.poll(5, java.util.concurrent.TimeUnit.SECONDS)
            assertNotNull(helloLine, "Client did not send its hello frame")
            assertNotNull(eventLine, "Client did not send its queued event")

            val envelope = Json.decodeFromString<WireEnvelope>(helloLine)
            assertEquals(MessageType.HELLO, envelope.type)
            assertEquals(hello.appName, Json.decodeFromString<HelloPayload>(envelope.payloadJson).appName)
            assertEquals("""{"type":"NETWORK_EVENT"}""", eventLine)
        } finally {
            client.stop()
            server.close()
            serverThread.join(5_000)
        }
    }
}
