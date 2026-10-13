# Kotlin Multiplatform & Networking Architecture Reference

This reference documents the detailed Kotlin Multiplatform (KMP) architecture, networking interceptor mechanisms, data models, and serialization patterns used in BlameBackend.

---

## 1. Module Hierarchy

```
/client/
├── network-inspector/     # Core KMP library
│   ├── src/commonMain/    # Architecture & protocol shared across all platforms
│   │   ├── core/          # EventBus, Logger, Redactor, PayloadUtils, Capture
│   │   ├── ktor/          # Ktor client inspection plugin
│   │   ├── protocol/      # WireEnvelope, NetworkEventDto, PayloadDto
│   │   └── transport/     # InspectorClient socket transport contract
│   ├── src/jvmAndAndroidMain/ # OkHttp Interceptor implementation
│   │   ├── core/          # JVM/Android logger
│   │   └── okhttp/        # NetworkInspectorInterceptor
│   ├── src/androidMain/   # Android platform initializers & context bridge
│   ├── src/jvmMain/       # Desktop JVM socket implementation
│   └── src/nativeMain/    # iOS & Linux POSIX socket bridges
├── app/                   # Android sample application (OkHttp & Ktor testbench)
└── composeApp/            # Compose Multiplatform desktop and android demo
```

---

## 2. Core Protocol & Data Models

### 2.1 Wire Envelope
Every TCP packet sent from the target app to the host daemon is framed as a `WireEnvelope`:

```kotlin
@Serializable
data class WireEnvelope(
    val type: MessageType,
    val version: Int = PROTOCOL_VERSION,
    val timestamp: Long = Clock.System.now().toEpochMilliseconds(),
    val payloadJson: String
)
```

### 2.2 Message Types
1. **`HELLO`**: Transmitted immediately upon socket connection. Contains `HelloPayload` (deviceName, osVersion, appName, appVersion, capabilities).
2. **`NETWORK_EVENT`**: Dispatched for request start, response received, or request error. Contains `NetworkEventDto`.
3. **`PING` / `PONG`**: Heartbeat mechanism to detect stale ADB port-forwarding tunnels.
4. **`GOODBYE`**: Clean disconnection notification when host application terminates.

### 2.3 Payload Safety & Hex Dumps
`PayloadUtils.kt` inspects MIME types and raw byte contents:
- **Text & JSON**: Decoded to UTF-8 and pretty-printed if valid JSON.
- **Binary & Media** (`image/*`, `application/octet-stream`, `application/x-protobuf`): Flags `isBinary = true` and generates a safe hexadecimal string preview (`hexPreview`) of the first 256 bytes.
- **Safety Cap**: Default 64 KB limit (`64 * 1024L`). If body exceeds limit, the first 64 KB is captured and `truncated = true` is set.

---

## 3. OkHttp Non-Destructive Interception Pattern

OkHttp's `NetworkInspectorInterceptor` enforces non-destructive inspection:

```kotlin
class NetworkInspectorInterceptor(
    private val maxBodySizeBytes: Long = 64 * 1024L,
    private val redactor: HeaderRedactor = HeaderRedactor()
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()

        // 1. Non-destructively capture request headers & cloned body
        val requestCapture = NetworkEventCapture.fromRequest(request, redactor)
        InspectorEventBus.dispatch(requestCapture.asRequestEvent())

        // 2. Proceed through chain with failure interception
        val response: Response
        val startTime = System.currentTimeMillis()
        try {
            response = chain.proceed(request)
        } catch (e: Exception) {
            InspectorEventBus.dispatch(requestCapture.asErrorEvent(e))
            throw e // NEVER swallow!
        }

        // 3. Peek response body safely
        val peekedBody = response.peekBody(maxBodySizeBytes)
        val responsePayload = PayloadUtils.parsePayload(peekedBody.bytes(), response.header("Content-Type"))
        InspectorEventBus.dispatch(requestCapture.asResponseEvent(response, responsePayload, System.currentTimeMillis() - startTime))

        return response
    }
}
```

---

## 4. Ktor Client Plugin Pattern

Ktor uses a pipeline-based interceptor architecture via `createClientPlugin`:

```kotlin
val NetworkInspectorPlugin = createClientPlugin("NetworkInspector", ::NetworkInspectorPluginConfig) {
    on(Send) { request ->
        // Capture request before send
        val capture = NetworkEventCapture.fromKtorRequest(request)
        InspectorEventBus.dispatch(capture.asRequestEvent())
        
        // Proceed with original call
        proceed(request)
    }

    on(Receive) { response ->
        // Save response body to avoid consuming single-read channels
        val savedResponse = response.save()
        val payload = PayloadUtils.parsePayload(savedResponse.bodyAsChannel())
        InspectorEventBus.dispatch(capture.asResponseEvent(savedResponse, payload))
        proceed(savedResponse)
    }
}
```

---

## 5. Coroutine & Socket Transport Architecture

- **`InspectorClient`**: Maintains a background TCP socket connection to `127.0.0.1:10245`.
- **Channel Buffering**: Events from `InspectorEventBus` are sent to a `Channel<WireEnvelope>(capacity = 100, onBufferOverflow = BufferOverflow.DROP_OLDEST)`.
- If connection to daemon drops, connection retry runs with exponential backoff on `Dispatchers.IO` without holding lock on caller threads.
