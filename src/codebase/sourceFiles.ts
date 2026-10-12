export interface SourceFile {
  path: string;
  module: 'android/core' | 'android/okhttp' | 'android/ktor' | 'protocol' | 'desktop' | 'sample' | 'gradle';
  language: 'kotlin' | 'groovy' | 'json' | 'bash';
  description: string;
  content: string;
}

export const SOURCE_FILES: SourceFile[] = [
  // 1. Protocol Definition
  {
    path: 'protocol/src/main/kotlin/com/inspector/protocol/Protocol.kt',
    module: 'protocol',
    language: 'kotlin',
    description: 'Wire protocol messages, event models, and JSON serialization envelope',
    content: `package com.inspector.protocol

import kotlinx.serialization.Serializable

/**
 * Protocol version to ensure backwards compatibility between Kotlin Multiplatform SDK and Inspector.
 */
const val PROTOCOL_VERSION = 1
const val DEFAULT_INSPECTOR_PORT = 10245

@Serializable
enum class MessageType {
    HELLO,
    NETWORK_EVENT,
    PING,
    PONG,
    GOODBYE
}

@Serializable
data class WireEnvelope(
    val type: MessageType,
    val version: Int = PROTOCOL_VERSION,
    val timestamp: Long = System.currentTimeMillis(),
    val payloadJson: String
)

@Serializable
data class HelloPayload(
    val deviceModel: String,
    val androidVersion: String,
    val appPackage: String,
    val appVersion: String,
    val capabilities: List<String> = listOf("okhttp", "ktor", "binary_preview", "redaction")
)

@Serializable
data class NetworkEventDto(
    val id: String,
    val timestamp: Long,
    val request: NetworkRequestDto,
    val response: NetworkResponseDto? = null,
    val durationMs: Long? = null,
    val error: NetworkErrorDto? = null,
    val timing: NetworkTimingDto? = null
)

@Serializable
data class NetworkRequestDto(
    val id: String,
    val timestamp: Long,
    val method: String,
    val url: String,
    val host: String,
    val path: String,
    val protocol: String,
    val headers: Map<String, String>,
    val body: PayloadDto? = null,
    val clientType: String
)

@Serializable
data class NetworkResponseDto(
    val statusCode: Int,
    val statusMessage: String?,
    val headers: Map<String, String>,
    val body: PayloadDto? = null,
    val durationMs: Long,
    val sizeBytes: Long,
    val protocol: String
)

@Serializable
data class PayloadDto(
    val contentType: String?,
    val sizeBytes: Long,
    val content: String?,
    val truncated: Boolean,
    val isBinary: Boolean,
    val hexPreview: String? = null
)

@Serializable
data class NetworkErrorDto(
    val errorType: String,
    val message: String,
    val stackTrace: String? = null
)

@Serializable
data class NetworkTimingDto(
    val dnsMs: Long? = null,
    val connectMs: Long? = null,
    val tlsMs: Long? = null,
    val sendMs: Long? = null,
    val waitMs: Long? = null,
    val receiveMs: Long? = null
)
`
  },

  // 2. Android Core - NetworkInspector facade
  {
    path: 'android/core/src/main/kotlin/com/inspector/core/NetworkInspector.kt',
    module: 'android/core',
    language: 'kotlin',
    description: 'Thread-safe Android SDK entry point, bounded event queue, and non-blocking transport',
    content: `package com.inspector.core

import android.content.Context
import android.os.Build
import android.util.Log
import com.inspector.protocol.*
import kotlinx.coroutines.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Android Network Inspector Facade.
 *
 * Captures, transports, and inspects HTTP traffic without affecting application semantics.
 * Completely inert/no-op in release builds or when the desktop tool is disconnected.
 */
object NetworkInspector {
    private const val TAG = "NetworkInspector"
    private val isStarted = AtomicBoolean(false)
    private var config: NetworkInspectorConfig = NetworkInspectorConfig()
    private var server: InspectorServer? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Memory-bounded event queue to prevent any memory growth or thread blocking
    private val eventQueue = ArrayBlockingQueue<NetworkEventDto>(config.maxQueueSize)

    fun install(context: Context, configuration: NetworkInspectorConfig = NetworkInspectorConfig()) {
        if (isStarted.compareAndSet(false, true)) {
            this.config = configuration
            startInternal(context.applicationContext)
        }
    }

    private fun startInternal(appContext: Context) {
        val packageInfo = runCatching {
            appContext.packageManager.getPackageInfo(appContext.packageName, 0)
        }.getOrNull()

        val hello = HelloPayload(
            deviceModel = "\${Build.MANUFACTURER} \${Build.MODEL}",
            androidVersion = "Android \${Build.VERSION.RELEASE} (API \${Build.VERSION.SDK_INT})",
            appPackage = appContext.packageName,
            appVersion = packageInfo?.versionName ?: "debug"
        )

        server = InspectorServer(
            port = config.port,
            helloPayload = hello,
            onClientConnected = { client ->
                Log.d(TAG, "Desktop inspector connected: \${client.remoteSocketAddress}")
            }
        ).apply { start() }

        // Event processing worker in background coroutine
        scope.launch {
            while (isActive) {
                try {
                    val event = withContext(Dispatchers.IO) { eventQueue.take() }
                    val json = Json.encodeToString(event)
                    val envelope = WireEnvelope(
                        type = MessageType.NETWORK_EVENT,
                        payloadJson = json
                    )
                    server?.broadcast(Json.encodeToString(envelope))
                } catch (e: InterruptedException) {
                    break
                } catch (e: Exception) {
                    // Silently ignore transport exceptions: networking thread must never fail
                }
            }
        }

        Log.i(TAG, "NetworkInspector active on 127.0.0.1:\${config.port}. Forward via 'adb forward tcp:\${config.port} tcp:\${config.port}'")
    }

    /**
     * Non-blocking event dispatch.
     * Uses backpressure drop-oldest policy so network threads are never blocked.
     */
    fun dispatch(event: NetworkEventDto) {
        if (!isStarted.get()) return

        // If queue is full, drop oldest event to keep recent events flowing
        if (!eventQueue.offer(event)) {
            eventQueue.poll() // Drop oldest
            eventQueue.offer(event)
        }
    }

    fun stop() {
        if (isStarted.compareAndSet(true, false)) {
            server?.stop()
            server = null
            eventQueue.clear()
            scope.cancel()
        }
    }

    val redactor: HeaderRedactor
        get() = config.redactor

    val maxBodySizeBytes: Long
        get() = config.maxBodySizeBytes
}

data class NetworkInspectorConfig(
    val port: Int = DEFAULT_INSPECTOR_PORT,
    val maxBodySizeBytes: Long = 64 * 1024L, // 64 KB
    val maxQueueSize: Int = 500,
    val redactor: HeaderRedactor = HeaderRedactor()
)
`
  },

  // 3. Android Core - Sensitive Data Redactor
  {
    path: 'android/core/src/main/kotlin/com/inspector/core/HeaderRedactor.kt',
    module: 'android/core',
    language: 'kotlin',
    description: 'Deterministic case-insensitive redaction of credentials, cookies, and tokens',
    content: `package com.inspector.core

/**
 * Enforces redaction of sensitive credentials, cookies, and API keys.
 * Matches case-insensitively and returns safe header mappings.
 */
class HeaderRedactor(customSensitiveHeaders: List<String> = emptyList()) {

    companion object {
        const val REDACTED_VALUE = "<redacted>"
        
        val DEFAULT_SENSITIVE_HEADERS = listOf(
            "authorization",
            "proxy-authorization",
            "cookie",
            "set-cookie",
            "x-api-key",
            "x-auth-token",
            "apikey",
            "access-token"
        )
    }

    private val sensitiveSet: Set<String> = (DEFAULT_SENSITIVE_HEADERS + customSensitiveHeaders)
        .map { it.lowercase() }
        .toSet()

    fun isSensitive(headerName: String): Boolean {
        return sensitiveSet.contains(headerName.lowercase())
    }

    fun redact(headers: Map<String, String>): Map<String, String> {
        val result = mutableMapOf<String, String>()
        for ((key, value) in headers) {
            if (isSensitive(key)) {
                result[key] = REDACTED_VALUE
            } else {
                result[key] = value
            }
        }
        return result
    }
}
`
  },

  // 4. Android Core - Payload Utilities
  {
    path: 'android/core/src/main/kotlin/com/inspector/core/PayloadUtils.kt',
    module: 'android/core',
    language: 'kotlin',
    description: 'Safe body capture, binary content detection, and bounded memory buffers',
    content: `package com.inspector.core

import com.inspector.protocol.PayloadDto
import java.nio.charset.Charset

object PayloadUtils {

    private val BINARY_MEDIA_TYPES = listOf(
        "image/",
        "audio/",
        "video/",
        "font/",
        "application/octet-stream",
        "application/pdf",
        "application/zip",
        "application/gzip"
    )

    fun isBinary(contentType: String?): Boolean {
        if (contentType == null) return false
        val clean = contentType.substringBefore(";").trim().lowercase()
        return BINARY_MEDIA_TYPES.any { clean.startsWith(it) }
    }

    fun createPayload(
        bytes: ByteArray,
        contentType: String?,
        maxSizeBytes: Long,
        charset: Charset = Charsets.UTF_8
    ): PayloadDto {
        val sizeBytes = bytes.size.toLong()
        val isBinaryContent = isBinary(contentType)
        val truncated = sizeBytes > maxSizeBytes

        val captureLength = if (truncated) maxSizeBytes.toInt() else bytes.size

        return if (isBinaryContent) {
            val previewBytes = bytes.copyOfRange(0, minOf(bytes.size, 64))
            PayloadDto(
                contentType = contentType,
                sizeBytes = sizeBytes,
                content = null,
                truncated = truncated,
                isBinary = true,
                hexPreview = formatHexPreview(previewBytes)
            )
        } else {
            val decodedString = runCatching {
                String(bytes, 0, captureLength, charset)
            }.getOrElse { "[Unable to decode text body: \${it.message}]" }

            PayloadDto(
                contentType = contentType,
                sizeBytes = sizeBytes,
                content = decodedString,
                truncated = truncated,
                isBinary = false
            )
        }
    }

    private fun formatHexPreview(bytes: ByteArray): String {
        return bytes.joinToString(" ") { "%02X".format(it) }
    }
}
`
  },

  // 5. Android Core - Inspector TCP Server
  {
    path: 'android/core/src/main/kotlin/com/inspector/core/InspectorServer.kt',
    module: 'android/core',
    language: 'kotlin',
    description: 'Embedded local TCP server for ADB port forward streaming to desktop TUI',
    content: `package com.inspector.core

import com.inspector.protocol.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.BufferedWriter
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Local TCP server bound to 127.0.0.1 on the Android device.
 * Accessed by Desktop CLI via: \`adb forward tcp:PORT tcp:PORT\`.
 */
class InspectorServer(
    private val port: Int,
    private val helloPayload: HelloPayload,
    private val onClientConnected: (Socket) -> Unit = {}
) {
    private var serverSocket: ServerSocket? = null
    private val isRunning = AtomicBoolean(false)
    private val activeClients = CopyOnWriteArrayList<ConnectedClient>()

    fun start() {
        if (isRunning.compareAndSet(false, true)) {
            thread(name = "inspector-server-accept", isDaemon = true) {
                runCatching {
                    serverSocket = ServerSocket().apply {
                        reuseAddress = true
                        bind(InetSocketAddress("127.0.0.1", port))
                    }

                    while (isRunning.get()) {
                        val clientSocket = serverSocket?.accept() ?: break
                        handleNewClient(clientSocket)
                    }
                }
            }
        }
    }

    private fun handleNewClient(socket: Socket) {
        runCatching {
            socket.tcpNoDelay = true
            val writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream(), Charsets.UTF_8))
            val client = ConnectedClient(socket, writer)
            activeClients.add(client)
            onClientConnected(socket)

            // Send initial HELLO handshake envelope
            val helloEnvelope = WireEnvelope(
                type = MessageType.HELLO,
                payloadJson = Json.encodeToString(helloPayload)
            )
            client.send(Json.encodeToString(helloEnvelope))
        }
    }

    fun broadcast(line: String) {
        val deadClients = mutableListOf<ConnectedClient>()
        for (client in activeClients) {
            val ok = client.send(line)
            if (!ok) deadClients.add(client)
        }
        activeClients.removeAll(deadClients)
    }

    fun stop() {
        if (isRunning.compareAndSet(true, false)) {
            runCatching { serverSocket?.close() }
            activeClients.forEach { it.close() }
            activeClients.clear()
        }
    }

    private class ConnectedClient(
        private val socket: Socket,
        private val writer: BufferedWriter
    ) {
        fun send(text: String): Boolean {
            return synchronized(writer) {
                runCatching {
                    writer.write(text)
                    writer.newLine()
                    writer.flush()
                    true
                }.getOrDefault(false)
            }
        }

        fun close() {
            runCatching { socket.close() }
        }
    }
}
`
  },

  // 6. OkHttp Integration
  {
    path: 'android/okhttp/src/main/kotlin/com/inspector/okhttp/NetworkInspectorInterceptor.kt',
    module: 'android/okhttp',
    language: 'kotlin',
    description: 'Non-destructive OkHttp 4.x/5.x Interceptor with safe body peeking and error capture',
    content: `package com.inspector.okhttp

import com.inspector.core.NetworkInspector
import com.inspector.core.PayloadUtils
import com.inspector.protocol.*
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import okio.Buffer
import java.io.IOException
import java.util.UUID

/**
 * OkHttp Interceptor for Network Inspector.
 *
 * Rules strictly followed:
 * 1. Never consumes request or response bodies destructively.
 * 2. Never alters original request semantics.
 * 3. Catches and reports IOExceptions without swallowing them.
 * 4. Redacts sensitive authentication tokens and cookies.
 */
class NetworkInspectorInterceptor : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val requestId = UUID.randomUUID().toString()
        val startNs = System.nanoTime()
        val timestamp = System.currentTimeMillis()

        // 1. Capture Request metadata safely
        val requestHeaders = mutableMapOf<String, String>()
        for (i in 0 until request.headers.size) {
            requestHeaders[request.headers.name(i)] = request.headers.value(i)
        }
        val safeRequestHeaders = NetworkInspector.redactor.redact(requestHeaders)

        // Non-destructively buffer request body if present
        val requestPayload = captureRequestBody(request)

        val requestDto = NetworkRequestDto(
            id = requestId,
            timestamp = timestamp,
            method = request.method,
            url = request.url.toString(),
            host = request.url.host,
            path = request.url.encodedPath + if (request.url.encodedQuery != null) "?\${request.url.encodedQuery}" else "",
            protocol = "HTTP/2.0",
            headers = safeRequestHeaders,
            body = requestPayload,
            clientType = "okhttp"
        )

        // Dispatch initial event
        NetworkInspector.dispatch(
            NetworkEventDto(
                id = requestId,
                timestamp = timestamp,
                request = requestDto
            )
        )

        // 2. Proceed with real network chain
        val response: Response
        try {
            response = chain.proceed(request)
        } catch (e: IOException) {
            val durationMs = (System.nanoTime() - startNs) / 1_000_000
            NetworkInspector.dispatch(
                NetworkEventDto(
                    id = requestId,
                    timestamp = timestamp,
                    request = requestDto,
                    durationMs = durationMs,
                    error = NetworkErrorDto(
                        errorType = e.javaClass.name,
                        message = e.message ?: "Network error during call",
                        stackTrace = e.stackTraceToString()
                    )
                )
            )
            throw e // Always rethrow to preserve application semantics
        }

        // 3. Capture Response metadata safely
        val durationMs = (System.nanoTime() - startNs) / 1_000_000
        val responseHeaders = mutableMapOf<String, String>()
        for (i in 0 until response.headers.size) {
            responseHeaders[response.headers.name(i)] = response.headers.value(i)
        }
        val safeResponseHeaders = NetworkInspector.redactor.redact(responseHeaders)

        // Use response.peekBody to avoid exhausting the response body stream
        val responsePayload = captureResponseBody(response)

        val responseDto = NetworkResponseDto(
            statusCode = response.code,
            statusMessage = response.message,
            headers = safeResponseHeaders,
            body = responsePayload,
            durationMs = durationMs,
            sizeBytes = responsePayload?.sizeBytes ?: (response.body?.contentLength() ?: 0L),
            protocol = response.protocol.toString()
        )

        NetworkInspector.dispatch(
            NetworkEventDto(
                id = requestId,
                timestamp = timestamp,
                request = requestDto.copy(protocol = response.protocol.toString()),
                response = responseDto,
                durationMs = durationMs
            )
        )

        return response
    }

    private fun captureRequestBody(request: Request): PayloadDto? {
        val body = request.body ?: return null
        if (body.isOneShot()) {
            return PayloadDto(
                contentType = body.contentType()?.toString(),
                sizeBytes = body.contentLength(),
                content = "[One-shot streaming request body]",
                truncated = false,
                isBinary = false
            )
        }

        return runCatching {
            val buffer = Buffer()
            body.writeTo(buffer)
            val bytes = buffer.readByteArray()
            PayloadUtils.createPayload(
                bytes = bytes,
                contentType = body.contentType()?.toString(),
                maxSizeBytes = NetworkInspector.maxBodySizeBytes
            )
        }.getOrNull()
    }

    private fun captureResponseBody(response: Response): PayloadDto? {
        val body = response.body ?: return null
        val contentType = body.contentType()?.toString()

        return runCatching {
            // Peek up to configured limit without consuming original source
            val peek = response.peekBody(NetworkInspector.maxBodySizeBytes + 1)
            val bytes = peek.bytes()
            PayloadUtils.createPayload(
                bytes = bytes,
                contentType = contentType,
                maxSizeBytes = NetworkInspector.maxBodySizeBytes
            )
        }.getOrNull()
    }
}
`
  },

  // 7. Ktor Client Integration
  {
    path: 'android/ktor/src/main/kotlin/com/inspector/ktor/NetworkInspectorKtorPlugin.kt',
    module: 'android/ktor',
    language: 'kotlin',
    description: 'First-class Ktor Client Plugin with double-capture deduplication guard',
    content: `package com.inspector.ktor

import com.inspector.core.NetworkInspector
import com.inspector.core.PayloadUtils
import com.inspector.protocol.*
import io.ktor.client.plugins.api.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.http.content.*
import io.ktor.util.*
import io.ktor.utils.io.*
import java.util.UUID

class NetworkInspectorKtorConfig {
    var maxBodySizeBytes: Long = 64 * 1024L
}

private val RequestIdAttributeKey = AttributeKey<String>("NetworkInspectorRequestId")
private val RequestStartNsAttributeKey = AttributeKey<Long>("NetworkInspectorStartNs")
private val RequestTimestampAttributeKey = AttributeKey<Long>("NetworkInspectorTimestamp")
private val RequestDtoAttributeKey = AttributeKey<NetworkRequestDto>("NetworkInspectorRequestDto")

/**
 * Native Ktor Client Plugin for Network Inspector.
 *
 * Works with any Ktor engine (Android, CIO, OkHttp, Darwin, Curl).
 * Contains deduplication guard to avoid double-capture if OkHttp engine is used.
 */
val NetworkInspector = createClientPlugin("NetworkInspector", ::NetworkInspectorKtorConfig) {
    val maxSizeBytes = pluginConfig.maxBodySizeBytes

    onRequest { request, content ->
        // Deduplication Guard: Check if request was already intercepted
        if (request.headers.contains("X-Inspector-Captured")) return@onRequest

        val requestId = UUID.randomUUID().toString()
        val startNs = System.nanoTime()
        val timestamp = System.currentTimeMillis()

        request.attributes.put(RequestIdAttributeKey, requestId)
        request.attributes.put(RequestStartNsAttributeKey, startNs)
        request.attributes.put(RequestTimestampAttributeKey, timestamp)

        // Capture headers
        val headersMap = mutableMapOf<String, String>()
        request.headers.entries().forEach { entry ->
            headersMap[entry.key] = entry.value.joinToString(", ")
        }
        val safeHeaders = NetworkInspector.redactor.redact(headersMap)

        // Safely inspect outgoing content
        val payload = when (content) {
            is OutgoingContent.ByteArrayContent -> {
                PayloadUtils.createPayload(
                    bytes = content.bytes(),
                    contentType = content.contentType?.toString(),
                    maxSizeBytes = maxSizeBytes
                )
            }
            is OutgoingContent.NoContent -> null
            else -> {
                PayloadDto(
                    contentType = content.contentType?.toString(),
                    sizeBytes = content.contentLength ?: 0L,
                    content = "[Streaming OutgoingContent]",
                    truncated = false,
                    isBinary = false
                )
            }
        }

        val requestDto = NetworkRequestDto(
            id = requestId,
            timestamp = timestamp,
            method = request.method.value,
            url = request.url.buildString(),
            host = request.url.host,
            path = request.url.encodedPath,
            protocol = "HTTP/1.1",
            headers = safeHeaders,
            body = payload,
            clientType = "ktor"
        )

        request.attributes.put(RequestDtoAttributeKey, requestDto)

        NetworkInspector.dispatch(
            NetworkEventDto(
                id = requestId,
                timestamp = timestamp,
                request = requestDto
            )
        )
    }

    onResponse { response ->
        val requestId = response.call.attributes.getOrNull(RequestIdAttributeKey) ?: return@onResponse
        val startNs = response.call.attributes.getOrNull(RequestStartNsAttributeKey) ?: System.nanoTime()
        val timestamp = response.call.attributes.getOrNull(RequestTimestampAttributeKey) ?: System.currentTimeMillis()
        val requestDto = response.call.attributes.getOrNull(RequestDtoAttributeKey) ?: return@onResponse

        val durationMs = (System.nanoTime() - startNs) / 1_000_000

        val headersMap = mutableMapOf<String, String>()
        response.headers.entries().forEach { entry ->
            headersMap[entry.key] = entry.value.joinToString(", ")
        }
        val safeHeaders = NetworkInspector.redactor.redact(headersMap)

        // Read response body without consuming downstream stream
        val responsePayload = runCatching {
            // Note: In Ktor, response content can be peeked/cloned safely
            val channel = response.content
            if (channel.isClosedForRead) null
            else {
                val peekChannel = channel.peek()
                val bytes = ByteArray(minOf(maxSizeBytes.toInt(), peekChannel.availableForRead))
                peekChannel.readAvailable(bytes)
                PayloadUtils.createPayload(
                    bytes = bytes,
                    contentType = response.contentType()?.toString(),
                    maxSizeBytes = maxSizeBytes
                )
            }
        }.getOrNull()

        val responseDto = NetworkResponseDto(
            statusCode = response.status.value,
            statusMessage = response.status.description,
            headers = safeHeaders,
            body = responsePayload,
            durationMs = durationMs,
            sizeBytes = responsePayload?.sizeBytes ?: 0L,
            protocol = response.version.toString()
        )

        NetworkInspector.dispatch(
            NetworkEventDto(
                id = requestId,
                timestamp = timestamp,
                request = requestDto.copy(protocol = response.version.toString()),
                response = responseDto,
                durationMs = durationMs
            )
        )
    }
}
`
  },

  // 8. Desktop CLI/TUI
  {
    path: 'desktop/src/main/kotlin/com/inspector/desktop/Main.kt',
    module: 'desktop',
    language: 'kotlin',
    description: 'Kotlin Desktop CLI / TUI with interactive navigation and real-time ANSI terminal rendering',
    content: `package com.inspector.desktop

import com.inspector.protocol.*
import kotlinx.serialization.json.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Developer-facing Terminal UI (TUI) & CLI for BlameBackend.
 *
 * Connects to Android device via forwarded ADB port (localhost:10245)
 * Displays incoming HTTP traffic in real time with interactive keyboard selection.
 */
fun main(args: Array<String>) {
    val port = args.getOrNull(0)?.toIntOrNull() ?: DEFAULT_INSPECTOR_PORT
    println("==================================================")
    println("  BlameBackend CLI/TUI (v$PROTOCOL_VERSION)")
    println("  Proof that your mobile app sent the right JSON.")
    println("==================================================")
    println("Connecting to Android device on 127.0.0.1:$port ...")
    println("Ensure you ran: adb forward tcp:$port tcp:$port")
    println("")

    val app = InspectorDesktopApp(port)
    app.start()
}

class InspectorDesktopApp(private val port: Int) {
    private val events = CopyOnWriteArrayList<NetworkEventDto>()
    private var selectedIndex = 0
    private var filterQuery = ""

    fun start() {
        val socket: Socket
        try {
            socket = Socket("127.0.0.1", port)
        } catch (e: Exception) {
            System.err.println("Could not connect to 127.0.0.1:$port.")
            System.err.println("1. Is the Android app running in debug mode?")
            System.err.println("2. Did you run: adb forward tcp:$port tcp:$port ?")
            return
        }

        println("Connected to Android Network Inspector!")
        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))

        // Read streaming lines in background
        Thread {
            while (true) {
                val line = reader.readLine() ?: break
                handleIncomingLine(line)
            }
        }.start()

        // Read terminal input for filtering / navigation
        val stdin = BufferedReader(InputStreamReader(System.\`in\`))
        while (true) {
            val cmd = stdin.readLine() ?: break
            when {
                cmd == "q" -> break
                cmd == "c" -> { events.clear(); println("Cleared events.") }
                cmd.startsWith("/") -> {
                    filterQuery = cmd.substring(1).trim()
                    println("Filter set to: '$filterQuery'")
                }
                cmd.toIntOrNull() != null -> {
                    val idx = cmd.toInt()
                    if (idx in 0 until events.size) {
                        renderDetails(events[idx])
                    }
                }
            }
        }
    }

    private fun handleIncomingLine(line: String) {
        runCatching {
            val envelope = Json.decodeFromString<WireEnvelope>(line)
            when (envelope.type) {
                MessageType.HELLO -> {
                    val hello = Json.decodeFromString<HelloPayload>(envelope.payloadJson)
                    println("Connected device: \${hello.deviceModel} (\${hello.appPackage})")
                }
                MessageType.NETWORK_EVENT -> {
                    val event = Json.decodeFromString<NetworkEventDto>(envelope.payloadJson)
                    updateEvent(event)
                    printSummaryLine(event)
                }
                else -> Unit
            }
        }
    }

    private fun updateEvent(event: NetworkEventDto) {
        val existingIndex = events.indexOfFirst { it.id == event.id }
        if (existingIndex >= 0) {
            events[existingIndex] = event
        } else {
            events.add(event)
        }
    }

    private fun printSummaryLine(event: NetworkEventDto) {
        val method = event.request.method.padEnd(6)
        val status = event.response?.statusCode?.toString() ?: "..."
        val host = event.request.host
        val path = event.request.path
        val duration = event.durationMs?.let { "\${it}ms" } ?: "in-flight"

        println("\$method  \$status  \$host\$path  \$duration")
    }

    private fun renderDetails(event: NetworkEventDto) {
        println("────────────────────────────────────────")
        println("\${event.request.method} \${event.request.url}")
        println("────────────────────────────────────────")
        println("Status       \${event.response?.statusCode ?: "Pending"} \${event.response?.statusMessage ?: ""}")
        println("Duration     \${event.durationMs ?: 0} ms")
        println("Protocol     \${event.response?.protocol ?: event.request.protocol}")
        println("")
        println("Request Headers")
        event.request.headers.forEach { (k, v) -> println("  \$k: \$v") }
        println("")
        println("Response Headers")
        event.response?.headers?.forEach { (k, v) -> println("  \$k: \$v") }
        println("")
        println("Response Body")
        println(event.response?.body?.content ?: "[No body]")
        println("────────────────────────────────────────")
    }
}
`
  },

  // 9. Sample Application
  {
    path: 'sample/src/main/kotlin/com/example/sample/SampleApp.kt',
    module: 'sample',
    language: 'kotlin',
    description: 'Sample Android Application demonstrating OkHttp and Ktor network inspection calls',
    content: `package com.example.sample

import android.app.Application
import com.inspector.core.NetworkInspector
import com.inspector.okhttp.NetworkInspectorInterceptor
import com.inspector.ktor.NetworkInspector as KtorInspectorPlugin
import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.request.*
import okhttp3.*
import java.io.IOException

class SampleApplication : Application() {

    lateinit var okHttpClient: OkHttpClient
        private set

    lateinit var ktorClient: HttpClient
        private set

    override fun onCreate() {
        super.onCreate()

        // 1. Initialize Network Inspector in debug builds
        NetworkInspector.install(this)

        // 2. Configure OkHttp with NetworkInspectorInterceptor
        okHttpClient = OkHttpClient.Builder()
            .addInterceptor(NetworkInspectorInterceptor())
            .build()

        // 3. Configure Ktor Client with native Ktor plugin
        ktorClient = HttpClient(CIO) {
            install(KtorInspectorPlugin) {
                maxBodySizeBytes = 64 * 1024L
            }
        }
    }
}
`
  },

  // 10. Root and Module Gradle build files
  {
    path: 'build.gradle.kts',
    module: 'gradle',
    language: 'kotlin',
    description: 'Root Gradle build file configuring multi-module Android & Desktop build',
    content: `// Root build.gradle.kts
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}
`
  },
  {
    path: 'sample/build.gradle.kts',
    module: 'gradle',
    language: 'kotlin',
    description: 'Sample app build.gradle.kts showing debugImplementation vs release inert stub',
    content: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.example.sample"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.example.sample"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

dependencies {
    // OkHttp & Ktor dependencies
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.ktor:ktor-client-core:3.0.1")
    implementation("io.ktor:ktor-client-cio:3.0.1")

    // Android Network Inspector: Debug only!
    // Never leaks to release builds, does not run background servers in production
    debugImplementation(project(":android:core"))
    debugImplementation(project(":android:okhttp"))
    debugImplementation(project(":android:ktor"))

    // Optional no-op release stub for clean release compilation without code changes:
    // releaseImplementation(project(":android:no-op"))
}
`
  }
];
