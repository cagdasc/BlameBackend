# AGENTS.md - BlameBackend Agent Instructions

This document follows the [AGENTS.md](https://agents.md/) standard for AI coding agents (Claude Code, Cursor, Codex, Windsurf, Devin, AI Studio, and terminal agents). It defines the operational commands, coding habits, architectural boundaries, and safety invariants for working in this repository.

---

## Project Overview

BlameBackend is a real-time, zero-semantics-alteration network inspection system for Kotlin Multiplatform (Android, JVM, iOS, Compose Desktop, Linux) and a Node.js daemon with an interactive Terminal TUI Web Console and headless CLI.

- **Primary Goal**: Intercept, stream, and inspect HTTP/HTTPS traffic from apps over local TCP (`127.0.0.1:10245`) without altering request/response behavior or dropping requests if the daemon disconnects.
- **Key Modules**:
  - `:network-inspector-core` — Shared Kotlin Multiplatform protocol, capture, redaction, and transport.
  - `:network-inspector-ktor` — Ktor client plugin adapter.
  - `:network-inspector-okhttp` — OkHttp interceptor adapter for JVM and Android.
  - `:app` & `:composeApp` — Android and Compose Desktop sample applications.
  - `server.ts` & `adbManager.ts` — Express daemon, ADB port-forwarding bridge, and raw TCP server.
  - `src/` — React 19 + Tailwind CSS v4 Terminal TUI Web Console.
  - `desktop-cli.ts` — Headless shell streaming CLI.

---

## Tech Stack & Versions

- **Mobile & Multiplatform**:
  - Kotlin `2.1.0` (Multiplatform DSL)
  - Android Gradle Plugin `8.7.3` (compileSdk/targetSdk: 35, minSdk: 24)
  - Compose Multiplatform `1.7.3`
  - `kotlinx-coroutines-core:1.10.1`, `kotlinx-serialization-json:1.8.0`, `kotlinx-datetime:0.6.1`
  - `okhttp:4.12.0` (JVM & Android)
  - `ktor-client-core:3.0.3` & `ktor-client-cio:3.0.3`
- **Host Daemon & Web Console**:
  - Node.js `22.x+` (ES Modules)
  - TypeScript `5.8+` / `7.0.2`
  - React `19.0.1`, React DOM `19.0.1`
  - Vite `8.3.0`, `@tailwindcss/vite: 4.3.3`, Tailwind CSS `4.3.3`
  - Express `4.21.2`, `tsx: 4.21.0`, `esbuild`

---

## Setup & Execution Commands

### Host Daemon, Web Console & CLI
- **Install dependencies**: `npm install`
- **Start dev server** (Web UI + TCP daemon on http://localhost:3000): `npm run dev`
- **Run headless CLI** (Streams network events directly in shell): `npm run cli`
- **Typecheck & Lint**: `npm run lint`
- **Build production bundles** (Vite + Node server bundle): `npm run build`
- **Start production server**: `npm run start`
- **Preview static frontend**: `npm run preview`

### Kotlin Multiplatform & Android
- **Build KMP libraries**: `./gradlew :network-inspector-core:assemble :network-inspector-ktor:assemble :network-inspector-okhttp:assemble`
- **Run JVM tests**: `./gradlew :network-inspector-core:jvmTest :network-inspector-ktor:jvmTest :network-inspector-okhttp:jvmTest`
- **Build Android sample app**: `./gradlew :app:assembleDebug`
- **Run Compose Desktop app**: `./gradlew :composeApp:run`

### ADB & Port Forwarding
- **List attached devices**: `adb devices -l`
- **Manual port forward**: `adb forward tcp:10245 tcp:10245`
- **Reverse port forward (if needed)**: `adb reverse tcp:10245 tcp:10245`

---

## Agent Boundaries: Always Do, Ask First, Never Do

### Always Do (Invariants)
- **Zero-Semantics Alteration**: Always use `response.peekBody(maxBytes)` in OkHttp or non-destructive stream saving in Ktor.
- **Catch, Log, and Re-throw**: When intercepting network calls, catch exceptions to dispatch error telemetry, then immediately re-throw (`throw e`).
- **Defensive Redaction**: Always mask `Authorization`, `Cookie`, `Set-Cookie`, `x-api-key`, and other tokens using case-insensitive checks.
- **Fail-Soft Isolation**: Any failure in the inspector (daemon down, socket disconnected, JSON error) must fail silently without crashing the host app.
- **Keep `commonMain` Pure**: Keep business logic and protocol models in `commonMain` without platform imports (`java.io.*`, `android.util.*`).
- **Cap Body Buffering**: Enforce a strict 64 KB cap (`64 * 1024L`). Set `truncated = true` when exceeded.
- **Hex Preview for Binaries**: Detect binary MIME types and generate safe hex dumps (`hexPreview`) instead of corrupting text decoders.
- **Maintain Data Model Agreement**: Keep 1:1 parity between Kotlin DTOs in `Protocol.kt` and TypeScript interfaces in `src/types/inspector.ts`. Consult the `data-model-agreement` skill (`skills/data-model-agreement/SKILL.md`) and keep `docs/DATA_MODEL_AGREEMENT.md` updated after any change.

### Ask First
- Changing the wire envelope JSON schema (`WireEnvelope`, `MessageType`, `PROTOCOL_VERSION`).
- Modifying default networking ports (`10245` TCP or `3000` HTTP).
- Adding new heavyweight external dependencies to `:network-inspector-*` or `package.json`.
- Modifying Gradle release publishing configuration in `jitpack.yml` or root `build.gradle.kts`.

### Never Do (Strict Prohibitions)
- **NEVER** introduce or modify data models on one platform (Kotlin or TypeScript) without simultaneously synchronizing the other and updating `docs/DATA_MODEL_AGREEMENT.md`.
- **NEVER** call `response.body?.string()` or read unbuffered streams destructively.
- **NEVER** swallow network exceptions or return mock/fabricated 500 responses when network requests fail.
- **NEVER** perform blocking socket writes on the main UI thread or caller thread; use `Dispatchers.IO`.
- **NEVER** transmit raw auth credentials, passwords, or cookies across the wire.
- **NEVER** let an unreachable daemon (`127.0.0.1:10245`) crash the target Android/Desktop application.
- **NEVER** pass unvalidated user input directly into `execSync` or shell commands.
- **NEVER** keep unbounded arrays in Node.js process memory; use bounded circular buffers.

---

## Code Style & Conventions

### Kotlin Multiplatform (KMP)
```kotlin
// Pattern: Non-destructive peeking & error propagation
override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    val capture = NetworkEventCapture.fromRequest(request, redactor)
    InspectorEventBus.dispatch(capture.asRequestEvent())

    val response: Response
    try {
        response = chain.proceed(request)
    } catch (e: Exception) {
        InspectorEventBus.dispatch(capture.asErrorEvent(e))
        throw e // ALWAYS re-throw
    }

    val peekedBody = response.peekBody(MAX_BUFFER_BYTES)
    val payload = PayloadUtils.parsePayload(peekedBody.bytes(), response.header("Content-Type"))
    InspectorEventBus.dispatch(capture.asResponseEvent(response, payload))
    return response
}
```

### TypeScript / Node.js
```typescript
// Pattern: TCP chunk reassembly & fail-soft socket
let buffer = '';
socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const envelope: WireEnvelope = JSON.parse(line);
      handleEnvelope(envelope);
    } catch (err) {
      console.warn('Malformed wire frame ignored', err);
    }
  }
});
```

### Terminal TUI Ergonomics
- Maintain high-contrast dark theme (`#0c0e14` background, JetBrains Mono font).
- Keyboard shortcuts: `j`/`k` (navigate list), `/` (search focus), `Tab` (cycle panels), `c` (clear log).

---

## Project Structure Map

```
/
├── AGENTS.md                  # Unified AI agent specifications (this file)
├── CLAUDE.md                  # Claude Code entry point (symlink/reference)
├── .cursorrules               # Cursor IDE rules file
├── README.md                  # Human-readable documentation & demo video
├── docs/
│   ├── DATA_MODEL_AGREEMENT.md # Authoritative client-server schema parity contract
│   ├── TECH_STACK.md          # Deep-dive tech stack & wire protocol specification
│   └── CODING_HABITS.md       # Developer habits companion & PR checklist
├── skills/
│   ├── data-model-agreement/  # Skill for managing client/server schema parity
│   └── developer-habits/      # Reusable skill for agent environments
│       ├── SKILL.md           # Developer habits and strict invariants
│       └── references/        # Detailed KMP & Node architecture references
├── client/
│   ├── network-inspector/     # Core KMP library (commonMain, jvmAndAndroid, etc.)
│   ├── app/                   # Android sample application
│   └── composeApp/            # Compose Multiplatform sample (Desktop & Android)
├── src/                       # React 19 Web Console (Terminal TUI, ADB Manager)
├── server.ts                  # Node.js daemon (Raw TCP 10245, SSE, Express)
└── desktop-cli.ts             # Headless shell streaming CLI
```

---

## Data Model Agreement Protocol for Agents

Whenever modifying any data model on client (Kotlin) or server (TypeScript):
1. **Update Kotlin DTO**: `client/network-inspector-core/.../protocol/Protocol.kt`
2. **Update TypeScript Types**: `src/types/inspector.ts`
3. **Update Wire Handlers**: `server.ts` / `desktop-cli.ts` (if envelope changes)
4. **Update Documentation**: `docs/DATA_MODEL_AGREEMENT.md`
5. **Verify Parity**: Follow the checklist in `skills/data-model-agreement/SKILL.md` to ensure complete client-server parity.

---

## Verification & Testing

Before completing any task, execute:
1. `npm run lint` — Verify zero TypeScript compilation errors.
2. `npm run build` — Verify both Vite frontend and Node server bundle cleanly.
3. If Kotlin files were modified, build the affected `:network-inspector-*` module(s) (if Gradle daemon is available in environment).
