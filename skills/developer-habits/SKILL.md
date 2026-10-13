---
name: "developer-habits"
description: >-
  Codifies the developer's core coding habits, architectural principles, and
  strict DOs and DON'Ts for BlameBackend. Enforces non-destructive payload
  interception, zero-semantics alteration, defensive credential redaction,
  Kotlin Multiplatform source-set isolation, fail-soft TCP transport, and
  terminal-first UI ergonomics across Kotlin and TypeScript/Node.
---

# Developer Habits & Coding Standards

This skill defines the architectural philosophy, coding habits, patterns, and strict DOs and DON'Ts followed across the **BlameBackend** project. It serves as an authoritative guide for writing, reviewing, and extending code in both the **Kotlin Multiplatform (KMP)** client library and the **TypeScript / Node / React** host daemon and console.

---

## 1. Core Architectural Philosophy

### 1.1 The Golden Rule: Zero-Semantics Alteration
> **Network inspection must NEVER modify or break the host application's behavior.**
- An inspector must act as an invisible passive observer.
- Inspecting HTTP bodies or stream data must **never exhaust, close, or alter** the underlying input streams or buffers.
- If network inspection fails (e.g., BlameBackend daemon is offline, socket reset, JSON serialization fails), the host application's network request **must proceed uninterrupted**.

### 1.2 Fail-Soft & Zero-Impact Transport
- Never block the caller thread. All inspection serialization, event dispatching, and socket transmissions must happen asynchronously on background dispatchers (`Dispatchers.IO` in Kotlin, non-blocking I/O in Node).
- Socket connection drops or unreachable daemon ports (`10245`) must fail silently without crashing host apps or spamming uncaught runtime exceptions.

### 1.3 Defensive Privacy & Automatic Redaction
- Never transmit raw sensitive tokens, authorization credentials, cookies, or secrets across the wire.
- Redaction must be applied **at the source** before any wire envelope is serialized or broadcast.
- Header matching must always be case-insensitive (e.g., `authorization`, `Authorization`, `AUTHORIZATION`).

---

## 2. Kotlin Multiplatform (KMP) Coding Habits

### 2.1 Non-Destructive Body Peeking
- **OkHttp**: Always use OkHttp's `Response.peekBody(maxBytes)` or non-destructive Okio buffer cloning. Never call `response.body?.string()` or read `source` directly without buffering, as this consumes the stream and causes crashes downstream.
- **Ktor**: In Ktor plugins, use `HttpSend` transformations or receive pipelines that preserve body channels (e.g., reading through `ByteReadChannel` clones or double-receiving).

### 2.2 Exception Handling: Catch, Dispatch, and Re-throw
- When an interceptor encounters a network failure (`IOException`, `SocketTimeoutException`, SSL errors):
  1. Catch the exception.
  2. Record timing and build an `errorEvent` containing `errorType`, `message`, and sanitized stack trace.
  3. Dispatch the error event to `InspectorEventBus`.
  4. **Crucial**: Re-throw the exact exception (`throw e`) so the host application receives its expected network failure naturally.

### 2.3 Strict Source-Set Isolation
- Maintain all business logic, protocol definitions (`Protocol.kt`), redaction engines (`HeaderRedactor.kt`), and event bus abstractions (`InspectorEventBus.kt`) in `commonMain`.
- Only platform-specific bridges belong in platform source sets:
  - `androidMain`: Android context, AndroidManifest permissions, Android logger.
  - `jvmMain` / `jvmAndAndroidMain`: OkHttp interceptor, JVM socket wrappers.
  - `nativeMain` / `iosMain`: iOS socket bridges and POSIX logging.
- Do not import Java-specific packages (e.g., `java.net.*`, `java.io.*`) into `commonMain`.

### 2.4 Coroutine & Threading Discipline
- Dedicated background scope (`CoroutineScope(SupervisorJob() + Dispatchers.IO)`).
- Never use `runBlocking` inside request interception hooks.
- Use thread-safe data structures (`AtomicRef`, `ConcurrentHashMap` or mutex-protected state) when storing client sessions or pending requests.

---

## 3. TypeScript, Node & Web Console Habits

### 3.1 Dual-Mode Architecture (TUI Web + Headless CLI)
- The backend serves both the interactive browser console (`App.tsx` + `TerminalTui.tsx`) and the headless terminal CLI (`desktop-cli.ts`).
- Shared wire protocol decoders must handle line-delimited or chunked JSON cleanly, handling partial buffers and socket fragmentations.

### 3.2 Server-Sent Events (SSE) for Real-Time Streaming
- Prefer SSE (`/api/stream`) over heavy full-duplex WebSockets when data primarily streams downstream from daemon to UI.
- Implement robust client reconnection loops with backoff in `liveSocketClient.ts`.
- Prune stale SSE client responses on write failure to prevent memory leaks.

### 3.3 Terminal-First UI Ergonomics
- The Web UI is modeled after terminal TUIs: dark slate backgrounds (`#0c0e14`), JetBrains Mono monospace font, and high-contrast status colors.
- Keyboard navigation is a first-class feature:
  - `j` / `k` or `ArrowDown` / `ArrowUp` for navigating request list.
  - `/` for focusing the search/filter bar.
  - `c` for clearing the event list.
  - `Tab` for toggling between panels and tabs.
- Always include an offline simulator (`src/engine/mockClient.ts`) so developers can test the UI without requiring an active device or Android emulator.

### 3.4 ADB Management Encapsulation
- Keep all ADB process spawning (`adb devices -l`, `adb forward tcp:10245 tcp:10245`) isolated inside `adbManager.ts`.
- Always sanitize device serial arguments to prevent shell command injection.
- Gracefully handle environments where `adb` is missing from the system `PATH`.

---

## 4. Strict DOs and DON'Ts Matrix

| Category | DO ✅ | DON'T ❌ |
| :--- | :--- | :--- |
| **Stream Handling** | Use `peekBody(maxBytes)` or clone Okio Buffer before reading. | Call `response.body?.string()` or consume `response.body?.byteStream()`. |
| **Error Handling** | Catch network exceptions, log via `InspectorEventBus`, and `throw e`. | Swallow network exceptions or return a fabricated 500 Response. |
| **Security & Privacy** | Case-insensitively mask headers like `Authorization` and `Cookie` to `<redacted>`. | Send raw auth tokens, bearer credentials, or session cookies in wire packets. |
| **Threading** | Dispatch network events asynchronously on `Dispatchers.IO`. | Run blocking socket I/O on the main/UI thread or interceptor caller thread. |
| **KMP Structure** | Place `Protocol.kt`, `HeaderRedactor.kt`, and `PayloadUtils.kt` in `commonMain`. | Import `java.io.*` or `android.util.Log` inside `commonMain`. |
| **Payload Limits** | Enforce a strict buffer cap (e.g., 64 KB) and set `truncated = true`. | Buffer unlimited multi-megabyte video/file downloads into memory. |
| **Binary Data** | Detect binary content types and provide safe hexadecimal previews (`hexPreview`). | Attempt to parse raw binary/protobuf data as UTF-8 strings. |
| **Daemon Availability** | Fail silently and let network requests complete if daemon is disconnected. | Crash the host application or throw `ConnectException` because daemon is down. |
| **Web Console UI** | Support keyboard shortcuts (`j`/`k`, `/`, `Tab`, `c`) and monospace layouts. | Rely solely on mouse clicks or build bloated multi-level navigation trees. |
| **Backend State** | Use bounded ring buffers for cached events to prevent memory exhaustion. | Store an unbounded array of network events in Node.js process memory. |

---

## 5. Code Pattern Reference

### 5.1 Kotlin: Safe OkHttp Request Interception
```kotlin
// ✅ DO: Non-destructive buffering and re-throwing
override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    
    // Non-destructively clone request body buffer
    val requestPayload = captureRequestBody(request)
    val capture = NetworkEventCapture(...)
    InspectorEventBus.dispatch(capture.requestEvent())

    val response: Response
    try {
        response = chain.proceed(request)
    } catch (e: Exception) {
        InspectorEventBus.dispatch(capture.errorEvent(e))
        throw e // Re-throw to preserve host app semantics!
    }

    // Safely peek response body without exhausting the stream
    val peekedBody = response.peekBody(MAX_BUFFER_BYTES)
    val responsePayload = PayloadUtils.parsePayload(peekedBody.bytes(), response.header("Content-Type"))
    InspectorEventBus.dispatch(capture.responseEvent(response, responsePayload))

    return response
}
```

```kotlin
// ❌ DON'T: Destructive reading that breaks the app
override fun intercept(chain: Interceptor.Chain): Response {
    val response = chain.proceed(chain.request())
    val bodyString = response.body?.string() // DANGER: Consumes stream! App will crash next time it reads response.body!
    println("Response: $bodyString")
    return response
}
```

### 5.2 Kotlin: Case-Insensitive Sensitive Redactor
```kotlin
// ✅ DO: Case-insensitive token redaction
class HeaderRedactor(customSensitive: List<String> = emptyList()) {
    private val sensitiveSet = (DEFAULT_SENSITIVE_HEADERS + customSensitive)
        .map { it.lowercase() }
        .toSet()

    fun redact(headers: Map<String, String>): Map<String, String> =
        headers.mapValues { (key, value) ->
            if (sensitiveSet.contains(key.lowercase())) "<redacted>" else value
        }
}
```

### 5.3 TypeScript: Fail-Soft Socket Connection in CLI
```typescript
// ✅ DO: Handle socket errors gracefully without unhandled rejections
const client = net.createConnection({ host: '127.0.0.1', port: 10245 }, () => {
  console.log('Connected to BlameBackend daemon.');
});

client.on('error', (err) => {
  console.warn(`[BlameBackend] Daemon not reachable on port 10245 (${err.message}). Is daemon running?`);
});
```

---

## 6. Pre-Commit & Code Review Checklist

When submitting code changes or new features:
- [ ] Are request and response bodies peeked non-destructively?
- [ ] Are sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`, `x-api-key`) redacted?
- [ ] Does the interceptor re-throw original network exceptions?
- [ ] Is payload buffering capped at 64 KB with `truncated` flag set when exceeded?
- [ ] Are binary MIME types detected and rendered via hex preview instead of corrupted text?
- [ ] Are platform-specific dependencies strictly separated from `commonMain`?
- [ ] Does the Web console maintain keyboard navigation (`j`/`k`, `/`, `Tab`, `c`)?
- [ ] Are ADB arguments validated before shell execution?
