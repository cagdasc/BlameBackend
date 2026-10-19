# BlameBackend: Complete Tech Stack & System Architecture Specification

This document provides an exhaustive technical breakdown of every sub-application, library module, communication protocol, and infrastructure component comprising the **BlameBackend** project.

---

## 1. System Overview & Architecture Diagram

BlameBackend is a real-time, zero-semantics alteration network inspector designed for multiplatform applications. It connects mobile, desktop, and embedded clients directly to a developer's host machine via TCP sockets and displays rich telemetry inside an interactive terminal-style web console or headless command-line interface.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT APPLICATIONS                             │
│                                                                        │
│   ┌───────────────────────────────┐  ┌───────────────────────────────┐ │
│   │ Android Sample App (:app)     │  │ Compose Desktop (:composeApp) │ │
│   │ - OkHttp Client               │  │ - Ktor Client                 │ │
│   │ - Jetpack Material 3 UI       │  │ - Compose Multiplatform UI    │ │
│   └──────────────┬────────────────┘  └──────────────┬────────────────┘ │
│                  │                                  │                  │
│   ┌──────────────▼──────────────────────────────────▼────────────────┐ │
│   │ Network Inspector Libraries                                      │ │
│   │ ├─ :network-inspector-core — protocol, redaction, capture, TCP   │ │
│   │ ├─ :network-inspector-ktor — Ktor client plugin                  │ │
│   │ └─ :network-inspector-okhttp — OkHttp interceptor                │ │
│   └──────────────────────────────┬───────────────────────────────────┘ │
└──────────────────────────────────┼─────────────────────────────────────┘
                                   │
               TCP Port 10245 (WireEnvelope JSON stream)
        ┌──────────────────────────┴──────────────────────────┐
        │  • Android USB: adb forward tcp:10245 tcp:10245     │
        │  • Android Emulator: 10.0.2.2:10245                 │
        │  • iOS Simulator / JVM Desktop: 127.0.0.1:10245     │
        └──────────────────────────┬──────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                     HOST DAEMON & ENGINE (server.ts)                   │
│                                                                        │
│   ┌──────────────────────────────┐   ┌───────────────────────────────┐ │
│   │ Node.js net.Server           │   │ ADB Bridge Manager            │ │
│   │ (TCP Listener on 10245)      │   │ - adb devices -l auto-detect  │ │
│   │ - Chunk reassembly buffer    │   │ - Automatic port forwarding   │ │
│   │ - JSON Envelope Parser       │   │ - Multi-device switching      │ │
│   └──────────────┬───────────────┘   └──────────────┬────────────────┘ │
│                  │                                  │                  │
│   ┌──────────────▼──────────────────────────────────▼────────────────┐ │
│   │ Express 4 HTTP / SSE Server (Port 3000)                          │ │
│   │ - /api/stream (Server-Sent Events for live events)               │ │
│   │ - /api/devices & /api/adb/* (Device management)                  │ │
│   │ - /api/events & /api/config (History & settings)                 │ │
│   │ - Vite Dev Middleware / Static Production Assets                 │ │
│   └──────────────┬──────────────────────────────────┬────────────────┘ │
└──────────────────┼──────────────────────────────────┼──────────────────┘
                   │                                  │
                   │ Server-Sent Events               │ Node IPC / TCP
                   ▼                                  ▼
┌──────────────────────────────────────┐   ┌─────────────────────────────┐
│ Terminal TUI Web Console (src/)      │   │ Headless Terminal CLI       │
│ - React 19 + TypeScript              │   │ (desktop-cli.ts)            │
│ - Tailwind CSS v4 + Motion           │   │ - Pure ANSI terminal stream │
│ - Keyboard-driven Navigation (j/k, /)│   │ - Zero browser dependency   │
│ - Request Simulator & Dispatcher     │   │ - CI/CD pipeline friendly   │
└──────────────────────────────────────┘   └─────────────────────────────┘
```

---

## 2. Per-Application Tech Stack Breakdown

### Kotlin Multiplatform Inspector Libraries

* **Paths**: `/client/network-inspector-core`, `/client/network-inspector-ktor`, `/client/network-inspector-okhttp`
* **Target Platforms**:
  * Android (`androidTarget`)
  * Desktop JVM (`jvm`)
  * iOS (`iosX64`, `iosArm64`, `iosSimulatorArm64`)
  * Native Linux (`linuxX64`)
* **Build System**: Gradle 8.11.1 with Kotlin Multiplatform DSL (`build.gradle.kts`)
* **Core module** (`:network-inspector-core`): protocol, event capture, redaction, and TCP transport shared by all targets.
* **Ktor module** (`:network-inspector-ktor`): multiplatform Ktor client plugin.
* **OkHttp module** (`:network-inspector-okhttp`): JVM/Android OkHttp interceptor.
* **Key dependencies**:
  * `kotlinx-coroutines-core:1.10.1` — Asynchronous event streaming and background socket transport.
  * `kotlinx-serialization-json:1.8.0` — Zero-reflection, high-speed wire protocol serialization.
  * `kotlinx-datetime:0.6.1` — High-precision epoch timestamps.
  * `okhttp3:okhttp` (JVM & Android) — OkHttp interceptor and buffer tapping.
  * `ktor-client-core` (All targets) — Ktor multiplatform client plugin.
* **Core architecture**:
  * `Protocol.kt`: Defines `WireEnvelope`, `MessageType`, `HelloPayload`, and `NetworkEventDto`.
  * `HeaderRedactor.kt`: Case-insensitive regex/set scrubber for sensitive auth tokens and cookies.
  * `PayloadUtils.kt`: Content-type classifier, 64 KB truncation guard, and binary hex-dump renderer.
  * `InspectorEventBus.kt`: Decoupled publish-subscribe event broker.
  * `InspectorClient.kt`: Resilient TCP socket client connecting to daemon with automatic retry backoff.

---

### Application 2: Android Sample App (`:app`)

* **Path**: `/client/app`
* **Target Platforms**: Android (minSdk: 24, compileSdk: 35, targetSdk: 35)
* **Build System**: Android Gradle Plugin (AGP) 8.7.3
* **Primary Language**: Kotlin 2.1.0
* **Key Dependencies**:
  * `androidx.core:core-ktx:1.15.0`
  * `androidx.appcompat:appcompat:1.7.0`
  * `com.google.android.material:material:1.12.0`
  * `androidx.activity:activity-ktx:1.9.3`
  * Project dependencies on `:network-inspector-core` and the relevant Ktor/OkHttp adapter.
* **Role**:
  * Provides a runnable mobile test harness on real physical Android devices and emulators.
  * Demonstrates initializing `NetworkInspector.install(...)` in `BlameBackendApplication.kt`.
  * Triggers concurrent GET, POST, and binary download requests via `MainActivity.kt` to verify live inspection.

---

### Application 3: Compose Multiplatform Desktop App (`:composeApp`)

* **Path**: `/client/composeApp`
* **Target Platforms**: Compose Desktop (JVM) and Android
* **Build System**: JetBrains Compose Multiplatform Gradle Plugin 1.7.3
* **Primary Language**: Kotlin 2.1.0
* **Key Dependencies**:
  * `org.jetbrains.compose.runtime:runtime`
  * `org.jetbrains.compose.foundation:foundation`
  * `org.jetbrains.compose.material3:material3`
  * `ktor-client-cio:3.0.3` — Ktor Coroutine I/O engine for desktop HTTP requests.
* **Role**:
  * Desktop testbench running directly on macOS, Linux, and Windows without requiring Android emulators.
  * Demonstrates seamless KMP sharing of networking code between desktop and mobile.

---

### Application 4: Host Server Daemon & ADB Bridge (`server.ts`, `adbManager.ts`)

* **Path**: `/server.ts` & `/src/server/adbManager.ts`
* **Runtime**: Node.js 22.x LTS with `tsx` (TypeScript Execution)
* **Bundler**: `esbuild` for production single-file bundle distribution (`dist/server.js`)
* **Primary Language**: TypeScript 5.8+ / ES Modules
* **Key Dependencies**:
  * `express: ^4.21.2` — REST API framework and static middleware.
  * `dotenv: ^17.2.3` — Environment variable management.
  * Node built-in `net` — Raw TCP socket server on port 10245.
  * Node built-in `child_process` — Spawns Android Debug Bridge (`adb`) commands.
* **Core Responsibilities**:
  * **Raw TCP Server**: Accepts incoming socket connections from any client over `127.0.0.1:10245`.
  * **Wire Frame Reassembly**: Assembles fragmented TCP chunks into complete newline-delimited JSON payloads.
  * **SSE Hub**: Streams incoming network events directly to connected web browser clients via `/api/stream`.
  * **ADB Auto-Bridge**: Executes `adb devices -l` to discover connected devices and invokes `adb forward tcp:10245 tcp:10245` automatically.
  * **Vite Integration**: Mounts Vite development middleware in dev mode (`npm run dev`) and serves precompiled static assets in production (`npm run start`).

---

### Application 5: Terminal TUI Web Console (`src/`)

* **Path**: `/src/`
* **Framework**: React 19 (`react: ^19.0.1`, `react-dom: ^19.0.1`)
* **Build Tool**: Vite 8 (`vite: ^8.3.0`, `@vitejs/plugin-react: ^6.1.1`)
* **Styling & Design System**: Tailwind CSS v4 (`@tailwindcss/vite: ^4.3.3`, `tailwindcss: ^4.3.3`)
* **Animation & Icons**:
  * `motion: ^12.23.24` (Framer Motion)
  * `lucide-react: ^0.546.0`
* **Key Components**:
  * `TerminalTui.tsx`: Split-screen terminal console with keyboard shortcuts (`j`/`k`, `/`, `Tab`, `c`).
  * `DeviceManager.tsx`: Interactive ADB device switcher, port configurator, and connection health dashboard.
  * `RequestSimulator.tsx`: Offline scenario generator triggering simulated mock network calls (REST, GraphQL, Binary, 4xx, 5xx).
  * `CustomDispatcher.tsx`: In-browser custom HTTP request builder to test interception without an external client.
  * `filterEngine.ts`: Tokenized query filter compiler (`status:200`, `method:POST`, `domain:...`).
  * `redactor.ts`: Client-side secondary display sanitizer.

---

### Application 6: Headless Terminal CLI (`desktop-cli.ts`)

* **Path**: `/desktop-cli.ts` & `/bin/blamebackend.js`
* **Runtime**: Node.js CLI executable (`blamebackend --cli`)
* **Dependencies**: Node built-in `net`, `process`, ANSI escape color sequences
* **Role**:
  * Headless terminal stream for developers preferring pure terminal workflows without opening a browser.
  * Connects directly to `127.0.0.1:10245` and formats live incoming HTTP requests in real-time.

---

## 3. Communication Protocols & Wire Schema

### 3.1 Wire Framing
Communication over the local TCP socket (`10245`) is formatted as **newline-delimited JSON (`\n`)**. Every packet is wrapped in a `WireEnvelope`.

```json
{
  "type": "NETWORK_EVENT",
  "version": 1,
  "timestamp": 1740000000000,
  "payloadJson": "{\"id\":\"evt_123\", ...}"
}
```

### 3.2 Message Types (`MessageType`)
| Type | Direction | Description |
| :--- | :--- | :--- |
| `HELLO` | Client ➔ Server | Sent immediately after socket connects. Identifies device name, OS version, app name, and capabilities. |
| `NETWORK_EVENT` | Client ➔ Server | Contains full request start, response completed, or network error DTO. |
| `PING` | Bidirectional | Heartbeat keep-alive frame sent every 30 seconds. |
| `PONG` | Bidirectional | Heartbeat acknowledgement frame. |
| `GOODBYE` | Client ➔ Server | Sent during graceful app shutdown. |

### 3.3 Data Transfer Objects (DTOs)

#### `HelloPayload`
```typescript
interface HelloPayload {
  deviceName: string;       // e.g., "Pixel 8 Pro", "MacBook Pro"
  osVersion: string;        // e.g., "Android 15", "macOS 15.3"
  appName: string;          // e.g., "com.cacaosd.blamebackend"
  appVersion: string;       // e.g., "1.0.0"
  capabilities: string[];   // ["okhttp", "ktor", "binary_preview", "redaction"]
}
```

#### `NetworkEventDto`
```typescript
interface NetworkEventDto {
  id: string;               // Unique UUID per request
  timestamp: number;        // Epoch millis
  request: NetworkRequestDto;
  response?: NetworkResponseDto | null;
  durationMs?: number | null;
  error?: NetworkErrorDto | null;
  timing?: NetworkTimingDto | null;
}
```

#### `PayloadDto`
```typescript
interface PayloadDto {
  contentType: string | null;  // e.g., "application/json"
  sizeBytes: number;           // Actual uncompressed body size
  content: string | null;      // UTF-8 string preview (if text)
  truncated: boolean;          // true if body exceeded 64 KB limit
  isBinary: boolean;           // true if image, audio, or protobuf
  hexPreview?: string | null;  // First 256 bytes formatted as hex dump
}
```

---

## 4. Network Topologies & Connection Matrix

| Client Environment | Connection Path | Setup Required |
| :--- | :--- | :--- |
| **Android Physical Device (USB)** | Device ➔ USB Cable ➔ ADB Daemon ➔ Node TCP | `adb forward tcp:10245 tcp:10245` (Handled automatically by BlameBackend) |
| **Android Physical Device (Wi-Fi)** | Device ➔ Wi-Fi ADB (Pairing code) ➔ Node TCP | Run `adb connect <ip>:<port>`, then automatic port forward activates |
| **Android Emulator** | Emulator ➔ Loopback IP `10.0.2.2:10245` ➔ Host | None. Emulator routes `10.0.2.2` directly to host machine `127.0.0.1` |
| **Compose Desktop / JVM** | Localhost socket ➔ `127.0.0.1:10245` | None. Directly connects to host loopback interface |
| **iOS Simulator** | Simulator socket ➔ `127.0.0.1:10245` | None. Shares host loopback interface |

---

## 5. Build, Package & Release Infrastructure

* **Node & Web Console**:
  * Build: `npm run build` (runs `vite build` + `esbuild` for Node server and CLI bundles into `dist/`)
  * Dev: `npm run dev` (starts `server.ts` with tsx and Vite dev middleware)
  * Headless CLI: `npm run cli` (runs `desktop-cli.ts`)
* **Kotlin Multiplatform Library**:
  * Build: `./gradlew :network-inspector-core:assemble :network-inspector-ktor:assemble :network-inspector-okhttp:assemble`
  * JitPack Publishing: Configured via `jitpack.yml` and root `build.gradle.kts` using `maven-publish` plugin.
* **CI/CD Automation**:
  * `.github/workflows/release.yml`: Automates building npm tarballs, computing SHA-256 checksums, and attaching release artifacts to GitHub Releases.
