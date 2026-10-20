# BlameBackend Project Roadmap

This document outlines the strategic product and engineering roadmap for **BlameBackend**. The roadmap prioritizes features based on architectural dependencies, developer ergonomics, protocol stability, and safety invariants (zero-semantics alteration and fail-soft execution).

---

## Strategic Phasing & Ordering Rationale

Features are grouped into four cohesive phases and ordered sequentially to ensure smooth architectural evolution:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 1: Deep Protocol Inspection (Passive Observability)               │
│ ├─ #1: GraphQL Inspection Support                                     │
│ └─ #2: WebSocket Stream & Frame Inspection                            │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 2: Session Observability & Replay (Data Portability)             │
│ └─ #3: Record Session (HAR & Native .bbsession Export / Import)        │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 3: Active Interception & Manipulation (Bi-Directional Engine)   │
│ ├─ #4: Mock Response Engine (Rule-based Short-Circuiting)             │
│ └─ #5: Hold Response & Manipulate on the Fly (Interactive Breakpoints)│
├────────────────────────────────────────────────────────────────────────┤
│ Phase 4: Unified Kotlin Architecture (Cross-Platform Daemon & UI)      │
│ └─ #6: Convert Server App to Compose Multiplatform (Desktop & Web)    │
└────────────────────────────────────────────────────────────────────────┘
```

### Why this order?
1. **Passive before Active**: Features 1–3 are purely observational (one-way client-to-daemon telemetry), requiring zero risk to the host application's network lifecycle.
2. **GraphQL before WebSockets**: GraphQL operates over standard HTTP POST/GET payloads, requiring only payload decoders. WebSockets introduces new connection states and duplex framing.
3. **Recording before Mocking**: Session recording captures real traffic traces that become the test fixtures and seed data for the mocking engine.
4. **Mocking before In-Flight Breakpoints**: Mocking introduces the bi-directional control channel with deterministic rules; interactive breakpoints build on this foundation by adding thread/coroutine suspension.
5. **Protocol & Feature Maturity before Compose Multiplatform Rewrite**: Solidifying all wire protocols and capabilities first prevents costly architectural rewrites during the transition to Compose Multiplatform.

---

## Detailed Roadmap Items

### Phase 1: Deep Protocol Inspection

#### 1. GraphQL Inspection Support
- **Sequence**: `#1`
- **Category**: Passive Protocol Decoders
- **Target Modules**: `:network-inspector-core`, Web TUI, CLI
- **Impact on Wire Protocol**: Minor (payload metadata extension).
- **Description**:
  Provide first-class inspection for GraphQL operations executing over HTTP POST (and GET query strings).
- **Key Capabilities**:
  - Automatically detect GraphQL requests via URL patterns (`/graphql`), `Content-Type: application/graphql-response+json`, or payload inspection (`query`, `mutation`, `subscription`).
  - Parse and display GraphQL operation type (`query`, `mutation`, `subscription`) and operation name (e.g. `query GetUserProfile`).
  - Structured display of GraphQL `variables` and formatted query syntax with syntax highlighting.
  - TUI & CLI badges displaying `[GQL: query]` or `[GQL: mutation]`.
  - Filter network logs specifically by GraphQL operation name or type.

#### 2. WebSocket Inspection Support
- **Sequence**: `#2`
- **Category**: Real-Time Duplex Protocol
- **Target Modules**: `:network-inspector-core`, `:network-inspector-ktor`, `:network-inspector-okhttp`, Daemon, Web TUI, CLI
- **Impact on Wire Protocol**: Moderate (adds new frame envelope types).
- **Description**:
  Inspect persistent WebSocket connections, handshake lifecycles, and bidirectional frame streams.
- **Key Capabilities**:
  - Intercept WebSocket lifecycle: Handshake (`WS_CONNECT`), Established (`WS_OPEN`), Closed (`WS_CLOSE`), and Errors (`WS_ERROR`).
  - Stream individual incoming (`RX`) and outgoing (`TX`) text and binary frames with microsecond timestamps.
  - Safe payload buffering: preview text frames and safe hex dumps for binary/protobuf frames up to 64 KB.
  - Dedicated WebSocket timeline view in Web Console showing connection duration, message counters, and frame exchange history.
  - Support for OkHttp `WebSocketListener` and Ktor Client `webSocket` plugin.

---

### Phase 2: Session Observability & Replay

#### 3. Record Session (HAR & Native .bbsession Export / Import)
- **Sequence**: `#3`
- **Category**: Session Management & Diagnostics
- **Target Modules**: Web TUI, Daemon, CLI
- **Impact on Wire Protocol**: None (host-level serialization).
- **Description**:
  Save, export, and load complete network inspection sessions for offline debugging, QA bug reports, and regression analysis.
- **Key Capabilities**:
  - **Standard HAR 1.2 Export**: Export HTTP/GraphQL traffic to standard `.har` format compatible with Charles, Proxyman, Chrome DevTools, and Postman.
  - **Native `.bbsession` Bundle**: Compressed JSON package containing full timeline events, timing metadata, redactor settings, device info, and WebSocket frames.
  - **Session Replayer**: Load recorded sessions into the Web TUI or Compose UI to inspect past issues with full search, filter, and detail views.
  - CLI flag to record directly to file: `blamebackend --record session-2026-10-19.bbsession`.

---

### Phase 3: Active Traffic Interception & Manipulation

#### 4. Mock Response Engine
- **Sequence**: `#4`
- **Category**: Active Interception (Deterministic Rules)
- **Target Modules**: `:network-inspector-core`, `:network-inspector-ktor`, `:network-inspector-okhttp`, Web TUI
- **Impact on Wire Protocol**: Major (establishes bidirectional client-server sync channel).
- **Description**:
  Intercept matching network calls before they reach the remote server and return canned, synthetic responses directly to the client app.
- **Key Capabilities**:
  - Rule matcher based on URL pattern (glob/regex), HTTP method, headers, or query parameters.
  - Configurable mock responses: custom status codes (e.g., `200 OK`, `401 Unauthorized`, `500 Internal Error`), custom headers, and JSON/text payloads.
  - Artificial network latency simulation (delay responses by $N$ ms to test loading states and timeouts).
  - Web UI Mock Manager to toggle, edit, and create mock rules that sync immediately to connected devices.
  - Zero-risk fail-soft: if the mock engine fails or socket disconnects, requests proceed normally.

#### 5. Hold Response & Manipulate on the Fly (Interactive Breakpoints)
- **Sequence**: `#5`
- **Category**: Active Interception (Interactive Tampering)
- **Target Modules**: `:network-inspector-core`, `:network-inspector-ktor`, `:network-inspector-okhttp`, Daemon, Web TUI
- **Impact on Wire Protocol**: Major (interactive pause/resume protocol with client-side suspension).
- **Description**:
  Pause in-flight requests or responses at breakpoints, allowing developers to inspect and edit HTTP headers, status codes, and body payloads before resuming the network call.
- **Key Capabilities**:
  - Breakpoint triggers: Pause on Request (edit outgoing headers/body) or Pause on Response (edit incoming status/headers/body before the app receives it).
  - Non-blocking client suspension:
    - Ktor: Suspends coroutine using `CompletableDeferred`.
    - OkHttp: Uses synchronized latch with strict safety timeout (e.g. 30s auto-release to prevent app ANRs).
  - Interactive Breakpoint Modal in Web TUI:
    - Visual badge: `⏸️ 1 Request Paused`.
    - Live editors for status code, response headers, and JSON body.
    - Actions: `Resume`, `Drop Request`, or `Forward Unmodified`.

---

### Phase 4: Unified Kotlin Architecture

#### 6. Convert Server App to Compose Multiplatform (Desktop & Web Target)
- **Sequence**: `#6`
- **Category**: Architecture & Platform Unification
- **Target Modules**: Entire host server & UI stack (`/server.ts`, `/src` ➔ `:host-compose-app`)
- **Impact on Wire Protocol**: Native implementation of TCP socket server and bridge.
- **Description**:
  Migrate the Node.js daemon and React frontend into a unified, pure Kotlin Multiplatform application targeting Desktop (JVM/Native) and Web (Compose for Web / Wasm).
- **Key Capabilities**:
  - **Compose Multiplatform Desktop**:
    - Native desktop application for macOS, Windows, and Linux.
    - Zero Node.js or browser runtime dependency.
    - Integrated Kotlin TCP server (Ktor Server with CIO or raw Java/Kotlin NIO sockets) on port `10245`.
    - Native ADB integration via embedded Kotlin ADB client.
  - **Compose Multiplatform for Web**:
    - Compiled via Kotlin/Wasm or Kotlin/JS.
    - Shares UI components, state management, and design system directly with the Desktop app.
  - **Single Tech Stack**: 100% Kotlin codebase across client libraries, host daemon, and developer UI.

---

## Roadmap Summary Table

| # | Feature | Phase | Category | Complexity | Target Release |
|---|---|---|---|---|---|
| **1** | **GraphQL Inspection Support** | Phase 1 | Deep Protocol Inspection | Low | `v0.2.0` |
| **2** | **WebSocket Inspection Support** | Phase 1 | Deep Protocol Inspection | Medium | `v0.3.0` |
| **3** | **Record Session (Export & Replay)** | Phase 2 | Observability & Portability | Medium | `v0.4.0` |
| **4** | **Mock Response Engine** | Phase 3 | Active Interception | High | `v0.5.0` |
| **5** | **Hold Response & Manipulate on the Fly** | Phase 3 | Active Interception | Very High | `v0.6.0` |
| **6** | **Server App to Compose Desktop & Web** | Phase 4 | Architecture Unification | High | `v1.0.0` |
