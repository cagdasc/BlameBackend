package com.cacaosd.networkinspector.testutil

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import kotlin.test.assertFalse
import kotlin.test.assertNotNull

class TestHttpServer(
    responseBody: String,
    private val statusLine: String = "200 OK",
    responseHeaders: Map<String, String> = emptyMap(),
) : Closeable {
    private val server = ServerSocket(0)
    private val failure = AtomicReference<Throwable?>()
    val port: Int = server.localPort

    @Volatile
    var requestBody: String? = null
        private set

    private val worker = thread(name = "inspector-test-http-server", isDaemon = true) {
        try {
            server.accept().use { socket ->
                val headers = readHeaders(socket)
                requestBody = readBody(socket, headers)

                val body = responseBody.encodeToByteArray()
                val headersText = buildString {
                    append("HTTP/1.1 $statusLine\r\n")
                    responseHeaders.forEach { (name, value) -> append("$name: $value\r\n") }
                    append("Content-Length: ${body.size}\r\n")
                    append("Connection: close\r\n\r\n")
                }
                socket.getOutputStream().apply {
                    write(headersText.encodeToByteArray())
                    write(body)
                    flush()
                }
            }
        } catch (error: Throwable) {
            failure.set(error)
        }
    }

    fun awaitSuccess() {
        worker.join(5_000)
        assertFalse(worker.isAlive, "HTTP test server did not finish")
        failure.get()?.let { throw AssertionError("HTTP test server failed", it) }
        assertNotNull(requestBody)
    }

    override fun close() {
        server.close()
    }

    private fun readHeaders(socket: Socket): List<String> {
        val input = socket.getInputStream()
        val headers = mutableListOf<String>()
        while (true) {
            val line = readAsciiLine(input)
            if (line.isEmpty()) return headers
            headers += line
        }
    }

    private fun readBody(socket: Socket, headers: List<String>): String {
        if (headers.any { it.startsWith("Transfer-Encoding: chunked", ignoreCase = true) }) {
            return readChunkedBody(socket.getInputStream())
        }
        val contentLength = headers
            .firstOrNull { it.startsWith("Content-Length:", ignoreCase = true) }
            ?.substringAfter(":")
            ?.trim()
            ?.toIntOrNull()
            ?: return ""
        val bytes = ByteArray(contentLength)
        var read = 0
        while (read < contentLength) {
            val count = socket.getInputStream().read(bytes, read, contentLength - read)
            if (count < 0) error("Request body ended early")
            read += count
        }
        return bytes.decodeToString()
    }

    private fun readChunkedBody(input: InputStream): String {
        val body = ByteArrayOutputStream()
        while (true) {
            val chunkLength = readAsciiLine(input).substringBefore(';').toInt(16)
            if (chunkLength == 0) {
                while (readAsciiLine(input).isNotEmpty()) Unit
                return body.toByteArray().decodeToString()
            }
            val chunk = ByteArray(chunkLength)
            var read = 0
            while (read < chunkLength) {
                val count = input.read(chunk, read, chunkLength - read)
                if (count < 0) error("Chunked request body ended early")
                read += count
            }
            body.write(chunk)
            if (input.read() != '\r'.code || input.read() != '\n'.code) {
                error("Malformed chunk ending")
            }
        }
    }

    private fun readAsciiLine(input: InputStream): String {
        val line = StringBuilder()
        while (true) {
            val value = input.read()
            if (value < 0) error("Request ended before the HTTP message completed")
            if (value == '\r'.code) {
                if (input.read() != '\n'.code) error("Malformed HTTP line ending")
                return line.toString()
            }
            line.append(value.toChar())
        }
    }
}
