# BlameBackend: Developer Habits, Architecture & DOs and DON'Ts

This document details the engineering habits, architectural patterns, and quality guidelines enforced across the **BlameBackend** codebase.

---

## 1. Core Engineering Philosophy

### 1. Zero-Semantics Alteration
The inspector must be an **invisible passive observer**. It must never change the outcome, timing characteristics, headers, or body streams of intercepted HTTP requests.

### 2. Fail-Soft Guarantee
If the BlameBackend daemon server is unreachable, dead, or throwing errors, the target application must continue running normally without crashing or dropping requests.

### 3. Defensive Privacy
Sensitive credentials (auth tokens, cookies, API keys) must be redacted **at the source** before leaving the client application.

---

## 2. Kotlin Multiplatform Habits

### ✅ What We Do (DO)
1. **Always use non-destructive body peeking**:
   - In OkHttp: Use `response.peekBody(maxBytes)`.
   - In Ktor: Clone or save the response body channel before reading.
2. **Re-throw all caught network exceptions**:
   - Catch the error to report it via `InspectorEventBus`.
   - Always re-throw (`throw e`) so the caller application handles network timeouts, SSL errors, and offline errors naturally.
3. **Keep `commonMain` pure**:
   - Keep data classes, JSON serialization, and redaction logic strictly in `commonMain`.
   - Never import Android or Java standard library classes (`java.io.*`, `android.util.Log`) in `commonMain`.
4. **Enforce buffer bounds**:
   - Limit body buffering to 64 KB (`64 * 1024L`).
   - If payload exceeds 64 KB, truncate gracefully and set `truncated = true`.
5. **Detect binary payloads safely**:
   - Check MIME types and byte contents.
   - Format binary payloads (images, audio, protobuf) as a safe 256-byte hexadecimal preview (`hexPreview`).

### ❌ What We Never Do (DON'T)
1. **Never exhaust the response body stream**:
   - ❌ `response.body?.string()` (OkHttp) — this closes the underlying stream and crashes the app when the caller attempts to read it.
2. **Never swallow network exceptions**:
   - ❌ Catching `IOException` and returning a fabricated `Response` with code 500 alters client logic.
3. **Never block the main or caller thread**:
   - ❌ Performing synchronous network socket writes inside an OkHttp interceptor will introduce latency into the host application.
4. **Never send raw credentials across the wire**:
   - ❌ Transmitting bearer tokens or session cookies in plaintext over local sockets poses a security risk.

---

## 3. TypeScript, Node & React Habits

### ✅ What We Do (DO)
1. **Support dual modes**:
   - Keep the system operable as both an interactive web console and a headless terminal CLI (`blamebackend --cli`).
2. **Build terminal-first web UI**:
   - Maintain a dark, high-contrast monospace aesthetic.
   - Provide full keyboard navigation:
     - `j` / `k` or `ArrowDown` / `ArrowUp`: Move selection up/down
     - `/`: Focus search input
     - `c`: Clear event log
     - `Tab`: Switch inspector tabs
3. **Handle TCP stream fragmentation**:
   - Reassemble partial TCP buffer chunks and delimit by newlines (`\n`).
4. **Sanitize shell arguments**:
   - Always validate ADB device serials with strict alphanumeric regex before invoking child processes.
5. **Cap in-memory event buffers**:
   - Keep event lists bounded (default 500 items) to prevent browser memory leaks during high-throughput network logging.

### ❌ What We Never Do (DON'T)
1. **Never rely on unhandled socket exceptions**:
   - ❌ Let Node crash if a client socket disconnects unexpectedly. Always attach `'error'` and `'close'` event handlers.
2. **Never store unbounded arrays in memory**:
   - ❌ Appending events indefinitely will eventually cause out-of-memory errors in long-running sessions.
3. **Never expose shell command execution without validation**:
   - ❌ Passing raw query parameters directly into `execSync` is a command injection risk.

---

## 4. Quick Reference Matrix

| Feature | Correct Pattern ✅ | Anti-Pattern ❌ |
| :--- | :--- | :--- |
| **OkHttp Response** | `response.peekBody(64 * 1024L).bytes()` | `response.body?.string()` |
| **Error Handling** | `catch (e: Exception) { dispatchError(e); throw e }` | `catch (e: Exception) { return mock500() }` |
| **Auth Headers** | Mask with `<redacted>` case-insensitively | Send raw `Bearer eyJhbGci...` |
| **Binary Body** | Hexadecimal preview string (`47 49 46 38...`) | Garbled UTF-8 string |
| **Large Payloads** | Buffer first 64 KB, flag `truncated: true` | Load 100 MB video into RAM |
| **Daemon Down** | Fail socket write silently, proceed with HTTP call | Throw `SocketException` into host app |
| **Web UI Controls** | Keyboard shortcuts (`j`/`k`, `/`, `Tab`, `c`) | Mouse-only clickable buttons |
| **ADB Exec** | Regex validated serial string | Unsanitized string template interpolation |

---

## 5. Pull Request & Code Review Checklist

Before opening a pull request or merging code changes:
- [ ] Network inspection logic does not modify request or response bodies.
- [ ] Sensitive authorization tokens and cookies are redacted.
- [ ] Network exceptions are caught, reported, and re-thrown.
- [ ] Socket transport failures do not crash the client application.
- [ ] Buffer caps are respected (max 64 KB per payload).
- [ ] Binary MIME types render hex previews instead of raw strings.
- [ ] Code compiles cleanly across Kotlin Multiplatform and TypeScript.
