# BlameBackend: WebSocket Inspection & GraphQL v0.0.3 Release Plan

A comprehensive architectural blueprint to incorporate duplex WebSocket inspection and update GraphQL support for the v0.0.3 release across the wire protocol, host daemon, React Terminal TUI console, and a complete implementation guide for the external Kotlin Multiplatform agent.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were confirmed during Phase 1 interactive clarification:
> - **WebSocket Wire Protocol**: Discrete WebSocket lifecycle and frame messages linked by a unique `connectionId` over the existing TCP `10245` wire connection, preserving non-blocking streaming.
> - **Daemon & Web Console Scope**: Full implementation on the host daemon (TCP parser & SSE broadcast), React Terminal TUI (duplex frame timeline, hex inspection, filtering), and WebSocket simulation in the DevTools console.
> - **GraphQL v0.0.3 Updates**: Update `ROADMAP.md` (mark GraphQL completed in v0.0.3), synchronize documentation/package metadata, and enhance GraphQL operation viewer & syntax formatting in the Web Console.
> - **Client-Side Boundary**: Zero code changes in `client/` by this agent; provide an exhaustive, production-ready implementation plan for the external agent building the Kotlin Multiplatform client library.

---

## 1. Overview & Core Concept

### What It Delivers
1. **GraphQL Support Formalization (v0.0.3)**:
   - Updates project metadata, `package.json`, `ROADMAP.md`, and `README.md` to reflect the completed release of Apollo GraphQL support in version `0.0.3`.
   - Enhances Web TUI with an improved GraphQL payload viewer (syntax-formatted GraphQL query display, variables JSON viewer, and GraphQL error badge/inspector).
2. **Duplex WebSocket Inspection (v0.4.0 / Phase 1 #2)**:
   - Wire contract extension with new message types: `WS_OPEN`, `WS_FRAME`, `WS_CLOSE`, `WS_ERROR`.
   - Host daemon (`server.ts`) reassembly and live SSE streaming of WebSocket sessions and high-frequency frames.
   - Terminal TUI dedicated WebSocket Inspector panel displaying active connections, duplex frame timeline (`TX` outgoing / `RX` incoming), opcode tags (Text, Binary, Ping, Pong, Close), microsecond delta timings, and 64 KB hex/text payload inspector.
   - Interactive WebSocket simulator in `RequestSimulator.tsx` to test live frame streaming without requiring an external mobile device.
3. **External Agent Client-Side Blueprint**:
   - Exact Kotlin Multiplatform class structures, OkHttp `WebSocketListener` wrapper, and Ktor Client `webSocket` interceptor hooks adhering to BlameBackend's zero-semantics alteration, defensive redaction, and fail-soft invariants.

---

## 2. User Experience & Visual Design

Following the **Developer & Monitoring Consoles (SaaS Dashboard)** visual rules:
- **Aesthetic Direction**: High-contrast utilitarian dark terminal theme (`#0c0e14` background, `#161b22` structural borders) with strict `font-mono` and `tabular-nums` alignment.
- **Color Discipline (60-30-10)**:
  - 60% neutral canvas (`#0c0e14`, `#0d1117`).
  - 30% structural surfaces (`#161b22` hairline borders, `#21262d` headers, `#8b949e` metadata).
  - 10% intentional semantic accents:
    - `TX` (Outgoing frame): Cyan `#38bdf8` (`bg-sky-950/40 text-sky-400 border border-sky-800/50`).
    - `RX` (Incoming frame): Emerald `#34d399` (`bg-emerald-950/40 text-emerald-400 border border-emerald-800/50`).
    - `WS_OPEN` / Active: Bright Green `#22c55e`.
    - `WS_CLOSE`: Slate Muted `#94a3b8`.
    - `WS_ERROR`: Crimson `#ef4444`.
- **Zero-Pill Metadata**: No generic rounded capsule pills on metadata. Statuses and directions use compact geometric markers with clean typographical dividers (`TX · TEXT · 128 B · +14ms`).
- **Layout Rhythm**:
  - Two-pane terminal view: Left pane shows unified HTTP & WebSocket connection streams with clear protocol badges (`[HTTP]`, `[GQL]`, `[WS]`).
  - Selecting a WebSocket connection switches the right pane into the **WebSocket Session Inspector**:
    - **Header Bar**: URL, Handshake status, connection duration timer, total frames exchanged (`TX: 12 · RX: 48`), and transferred bytes.
    - **Frame Stream List**: Real-time virtualized chronological frame feed with live search/opcode filters.
    - **Frame Detail Drawer**: Formatted JSON/Text viewer or 16-byte hex dump with ASCII sidebar for binary frames.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Discrete Frame Wire Framing vs Single Monolithic Event
- **Chosen Approach**: Discrete wire messages (`WS_OPEN`, `WS_FRAME`, `WS_CLOSE`, `WS_ERROR`) linked by `connectionId`.
- **Why**: WebSocket connections can remain active for minutes or hours with thousands of frames. Streaming frames individually prevents memory spikes on both the client device and the Node.js daemon, prevents dropped frames, and gives instant real-time UI updates.
- **Alternatives Considered**: Bundling frames inside a parent `NetworkEventDto` was rejected because it would require buffering thousands of frames in client RAM and transmitting massive JSON frames over the TCP socket.

### Decision 2: Unified Main List with Type Filtering vs Separate Tab
- **Chosen Approach**: Unified list by default with filter shortcuts (`all`, `http`, `graphql`, `websocket`) and custom filter query keywords (`type:ws`, `ws:rx`, `ws:tx`).
- **Why**: Developers want to observe the true chronological sequence of events (e.g. an HTTP auth call followed immediately by a WebSocket handshake). A unified stream preserves temporal context while filter buttons allow instant isolation.

### Decision 3: Fail-Soft Payload Capping
- **Chosen Approach**: Enforce the invariant 64 KB limit per frame (`64 * 1024L`). Text frames above 64 KB are marked `truncated = true`; binary frames generate a 256-byte `hexPreview`.
- **Why**: Prevents Android/Desktop memory exhaustion during high-throughput binary streaming.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Kotlin Multiplatform Client                          │
│                                                                        │
│  OkHttp WebSocketListener        Ktor Client webSocket Plugin          │
│  ┌──────────────────────┐        ┌─────────────────────────┐           │
│  │ onOpen, onMessage    │        │ incoming/outgoing frames│           │
│  └──────────┬───────────┘        └────────────┬────────────┘           │
│             └────────────────┬────────────────┘                        │
│                              ▼                                         │
│               ┌───────────────────────────────┐                        │
│               │ :network-inspector-core       │                        │
│               │ - WebSocketEventCapture       │                        │
│               │ - InspectorEventBus           │                        │
│               └──────────────┬────────────────┘                        │
└──────────────────────────────┼─────────────────────────────────────────┘
                               │ TCP: 10245 (Newline-delimited WireEnvelope)
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Node.js Host Daemon (server.ts)                   │
│  - Parses WS_OPEN, WS_FRAME, WS_CLOSE, WS_ERROR                        │
│  - Maintains in-memory session index & bounded ring buffer (500 frames)│
│  - Broadcasts via SSE: { type: 'WS_EVENT', event }                     │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ SSE /api/stream
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     React 19 Terminal TUI Console                      │
│  ┌───────────────────────────┬──────────────────────────────────────┐  │
│  │ Transaction Stream List   │ WebSocket Stream & Frame Inspector   │  │
│  │ • HTTP POST /graphql      │ • Connection: wss://api.example/ws   │  │
│  │ • WS wss://echo.ws [OPEN] │ • Frames (TX: 14 | RX: 32)           │  │
│  │   └─ TX 42B · RX 1.2KB    │ • Payload Inspector (Text/Hex Preview│  │
│  └───────────────────────────┴──────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Model Parity (Client Kotlin ⟷ Server TypeScript)

#### 1. Wire Message Types (`MessageType` & `WireMessageType`)
- Add opcodes: `WS_OPEN`, `WS_FRAME`, `WS_CLOSE`, `WS_ERROR`.

#### 2. `WebSocketConnectionDto`
```typescript
interface WebSocketConnectionDto {
  id: string; // Connection UUID
  timestamp: number; // Start epoch ms
  url: string; // e.g. "wss://echo.websocket.org"
  host: string;
  path: string;
  headers: Record<string, string>; // Redacted handshake headers
  clientType: 'okhttp' | 'ktor' | string;
  status: 'connecting' | 'open' | 'closed' | 'error';
  closeCode?: number | null;
  closeReason?: string | null;
  error?: NetworkErrorDto | null;
  totalTxFrames: number;
  totalRxFrames: number;
  totalTxBytes: number;
  totalRxBytes: number;
  durationMs?: number | null;
}
```

#### 3. `WebSocketFrameDto`
```typescript
interface WebSocketFrameDto {
  id: string; // Frame UUID
  connectionId: string; // Parent connection ID
  timestamp: number; // Epoch ms
  direction: 'tx' | 'rx'; // 'tx' = outgoing, 'rx' = incoming
  opcode: 'text' | 'binary' | 'ping' | 'pong' | 'close';
  payload: PayloadDto; // Content, size, truncated, isBinary, hexPreview
}
```

---

## 5. Detailed Client-Side Implementation Blueprint (For External Agent)

> [!NOTE]
> This section is specifically created for your external agent implementing the Kotlin Multiplatform client library. Follow this step-by-step guide without altering existing HTTP capture invariants.

### Step 1: Core Protocol & DTOs in `:network-inspector-core`
1. **File**: `client/network-inspector-core/src/commonMain/kotlin/com/cacaosd/networkinspector/protocol/Protocol.kt`
   - Extend `MessageType`:
     ```kotlin
     @Serializable
     enum class MessageType {
         HELLO,
         NETWORK_EVENT,
         PING,
         PONG,
         GOODBYE,
         WS_OPEN,
         WS_FRAME,
         WS_CLOSE,
         WS_ERROR
     }
     ```
   - Add `@Serializable` DTOs:
     ```kotlin
     @Serializable
     enum class WebSocketDirection { TX, RX }

     @Serializable
     enum class WebSocketOpcode { TEXT, BINARY, PING, PONG, CLOSE }

     @Serializable
     data class WebSocketConnectionDto(
         val id: String,
         val timestamp: Long,
         val url: String,
         val host: String,
         val path: String,
         val headers: Map<String, String>,
         val clientType: String,
         val status: String = "open",
         val closeCode: Int? = null,
         val closeReason: String? = null,
         val error: NetworkErrorDto? = null
     )

     @Serializable
     data class WebSocketFrameDto(
         val id: String,
         val connectionId: String,
         val timestamp: Long,
         val direction: WebSocketDirection,
         val opcode: WebSocketOpcode,
         val payload: PayloadDto
     )
     ```
2. **File**: `client/network-inspector-core/src/commonMain/kotlin/com/cacaosd/networkinspector/core/WebSocketCapture.kt`
   - Implement helper `WebSocketCapture` to construct `WS_OPEN`, `WS_FRAME`, `WS_CLOSE`, and `WS_ERROR` envelopes and dispatch them via `InspectorEventBus.dispatch(...)`.
   - Use `PayloadUtils.parsePayload(bytes, contentType)` to ensure the 64 KB cap and hex previews are enforced identically to HTTP payloads.

### Step 2: OkHttp Adapter in `:network-inspector-okhttp`
1. **File**: `client/network-inspector-okhttp/src/jvmAndAndroidMain/kotlin/com/cacaosd/networkinspector/okhttp/NetworkInspectorWebSocketListener.kt`
   - Implement a decorator around `okhttp3.WebSocketListener`:
     ```kotlin
     class NetworkInspectorWebSocketListener(
         private val delegate: WebSocketListener,
         private val request: Request,
         private val redactor: HeaderRedactor = HeaderRedactor.DEFAULT
     ) : WebSocketListener()
     ```
   - Intercept:
     - `onOpen(webSocket, response)`: Dispatch `WS_OPEN` with sanitized headers and URL.
     - `onMessage(webSocket, text)`: Dispatch `WS_FRAME` (direction = RX, opcode = TEXT).
     - `onMessage(webSocket, bytes)`: Dispatch `WS_FRAME` (direction = RX, opcode = BINARY, hex preview).
     - `onClosing / onClosed(webSocket, code, reason)`: Dispatch `WS_CLOSE`.
     - `onFailure(webSocket, t, response)`: Dispatch `WS_ERROR` with `NetworkErrorDto`.
   - Provide an extension: `OkHttpClient.newInspectedWebSocket(request, listener)`.

### Step 3: Ktor Client Adapter in `:network-inspector-ktor`
1. **File**: `client/network-inspector-ktor/src/commonMain/kotlin/com/cacaosd/networkinspector/ktor/NetworkInspectorWebSocket.kt`
   - Hook into Ktor's `WebSockets` plugin session:
   - Wrap the `DefaultClientWebSocketSession`:
     - Transform `incoming: ReceiveChannel<Frame>` using a tap coroutine channel that captures frames and forwards them without delay.
     - Wrap `outgoing: SendChannel<Frame>` so calls to `send(Frame)` dispatch `WS_FRAME` (TX) before pushing to the real channel.
   - Dispatch `WS_OPEN` upon session creation and `WS_CLOSE` on channel completion/cancellation.

### Step 4: Strict Invariants for the External Agent
- **Never Block**: All socket transmissions to `InspectorClient` must run asynchronously on `Dispatchers.IO` via `InspectorEventBus`.
- **Fail-Soft**: If `127.0.0.1:10245` is unreachable, all WebSocket operations continue without interruption.
- **Redaction**: Handshake headers (`Authorization`, `Sec-WebSocket-Key`, `Cookie`) must be passed through `HeaderRedactor`.

---

## 6. Host Daemon, Server, & Web Console Implementation Plan (This Agent)

### Phase A: Documentation, Versioning & GraphQL v0.0.3 Sync
1. **`ROADMAP.md`**: Update item #1 (GraphQL Inspection) status to **Released in `v0.0.3`**; advance WebSocket inspection to **Active Development (`v0.4.0`)**.
2. **`package.json`**: Bump version to `0.0.3` (or prepare for `0.4.0` with WebSocket).
3. **`README.md`**: Update demo video embed to reference `assets/blamebackend_demo-0_0_3.mp4` and highlight GraphQL v0.0.3 features.
4. **`docs/DATA_MODEL_AGREEMENT.md`**: Add the new WebSocket entities (`WebSocketConnectionDto`, `WebSocketFrameDto`) to the authoritative contract.

### Phase B: Server Daemon Protocol & Ingestion (`server.ts` & `src/types/inspector.ts`)
1. **`src/types/inspector.ts`**: Add `WebSocketConnectionDto`, `WebSocketFrameDto`, `WebSocketEvent`, and update `WireMessageType`.
2. **`server.ts`**:
   - Reassemble incoming `WS_OPEN`, `WS_FRAME`, `WS_CLOSE`, `WS_ERROR` wire messages.
   - Aggregate frame metrics (`totalTxFrames`, `totalRxFrames`, `totalTxBytes`, `totalRxBytes`).
   - Store frames in a bounded circular buffer (max 500 frames per connection to maintain low memory).
   - Broadcast via SSE to connected Web Consoles: `type: 'WS_CONNECTION'` and `type: 'WS_FRAME'`.
3. **`desktop-cli.ts`**: Render colorized ANSI logs for WebSocket frames (`[WS TX] 42B`, `[WS RX] 128B`).

### Phase C: React Terminal TUI & Console UI (`src/`)
1. **Protocol Filter & Badges**:
   - Add segmented filter controls in `TopBar.tsx` / `TerminalTui.tsx`: `ALL`, `HTTP`, `GRAPHQL`, `WEBSOCKET`.
   - Update `filterEngine.ts` to support `type:ws`, `type:graphql`, `ws:rx`, `ws:tx`.
2. **GraphQL v0.0.3 UI Enhancement**:
   - Enhanced operation card in `TerminalTui.tsx` with formatted query syntax highlighting, variables JSON tree view, and GraphQL response error parser.
3. **Dedicated WebSocket Session Inspector**:
   - Render connection summary, duplex stats, and chronological frame feed.
   - Filter frames by direction (`TX` / `RX`) and opcode (`Text` / `Binary`).
   - Frame payload inspector with raw string viewer, JSON formatter, and hex dump.
4. **WebSocket Simulator in `RequestSimulator.tsx`**:
   - Add an interactive mock WebSocket echo session simulating live `TX`/`RX` ping-pong and JSON frames to test the console immediately without external devices.

---

## 7. Verification & Parity Checklist

1. **Schema Parity**: Run audit comparing `Protocol.kt` (specified for external agent) against `src/types/inspector.ts` and `docs/DATA_MODEL_AGREEMENT.md`.
2. **Lint Validation**: Run `npm run lint` (`tsc --noEmit`) to verify zero TypeScript errors.
3. **Build Validation**: Run `compile_applet` and verify both Vite frontend and Node server bundle cleanly.
4. **Interactive Verification**: Trigger simulated WebSocket and GraphQL events in the DevTools console and verify frame updates, filtering, and hex previews.
