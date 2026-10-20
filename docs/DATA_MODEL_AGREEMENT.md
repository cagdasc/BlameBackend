# BlameBackend Data Model Agreement & Wire Contract Specification

> **Authoritative Specification**: This document is the single source of truth for data model agreement between the **Kotlin Multiplatform (KMP)** client libraries (`:network-inspector-core`, `:network-inspector-ktor`, `:network-inspector-okhttp`) and the **TypeScript / Node.js** host daemon, CLI, and Web Console.
>
> **Golden Rule**: Neither client nor server may introduce, rename, or drop fields without synchronizing both sides and updating this contract.

---

## 1. Architectural Overview & Wire Transport

The network inspection system operates over a raw TCP connection on port `10245`:
- **Android**: Port forwarded via ADB (`adb forward tcp:10245 tcp:10245` or `adb reverse tcp:10245 tcp:10245`).
- **Desktop JVM / iOS Simulator / Compose Linux**: Direct TCP socket to `127.0.0.1:10245`.
- **Wire Framing**: Newline-delimited JSON (`\n`). Every packet is a self-contained single-line UTF-8 JSON object formatted as a `WireEnvelope`.

```
┌────────────────────────────────────────┐
│ Kotlin Multiplatform Client            │
│ (Android, JVM, iOS, Compose Desktop)  │
└──────────────────┬─────────────────────┘
                   │ TCP:10245 (Newline-delimited WireEnvelope JSON)
                   ▼
┌────────────────────────────────────────┐
│ Node.js Server Daemon (server.ts)      │
│ • Reassembles TCP chunk fragments      │
│ • Parses WireEnvelope & HelloPayload   │
│ • Enriches events (clientId, device)   │
└────────┬──────────────────────┬────────┘
         │ SSE (/api/stream)    │ Stdout ANSI
         ▼                      ▼
┌───────────────────┐  ┌─────────────────┐
│ React Web Console │  │ Headless CLI    │
│ (src/App.tsx)     │  │ (desktop-cli.ts)│
└───────────────────┘  └─────────────────┘
```

---

## 2. Core Protocol Envelope (`WireEnvelope`)

Every frame transmitted over the TCP socket is wrapped in a `WireEnvelope`.

### 2.1 Kotlin Definition
```kotlin
// Location: client/network-inspector-core/src/commonMain/kotlin/.../protocol/Protocol.kt
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
    val timestamp: Long = Clock.System.now().toEpochMilliseconds(),
    val payloadJson: String
)
```

### 2.2 TypeScript Definition
```typescript
// Location: src/types/inspector.ts
export const PROTOCOL_VERSION = 1;
export const DEFAULT_INSPECTOR_PORT = 10245;

export type WireMessageType =
  | 'HELLO'
  | 'NETWORK_EVENT'
  | 'PING'
  | 'PONG'
  | 'GOODBYE';

export interface WireEnvelope {
  type: WireMessageType;
  version: number;
  timestamp: number;
  payloadJson: string;
}
```

### 2.3 Parity & Field Agreement

| Field | Kotlin Type | TypeScript Type | JSON Key | Nullable | Default Value | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `type` | `MessageType` | `WireMessageType` | `"type"` | No | - | Wire opcode (`HELLO`, `NETWORK_EVENT`, `PING`, `PONG`, `GOODBYE`) |
| `version` | `Int` | `number` | `"version"` | No | `1` | Wire schema version (`PROTOCOL_VERSION`) |
| `timestamp` | `Long` | `number` | `"timestamp"` | No | System epoch ms | Creation timestamp in epoch milliseconds |
| `payloadJson` | `String` | `string` | `"payloadJson"` | No | - | Serialized JSON string of the underlying DTO |

---

## 3. Handshake Model (`HelloPayload` & `DeviceInfo`)

Sent by the client immediately after TCP socket connection opens (`type = "HELLO"`).

### 3.1 Field Agreement Matrix

| Field | Kotlin `HelloPayload` | TypeScript `HelloPayload` | JSON Key | Nullable | Client Default | Server Role |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `deviceName` | `String` | `string` | `"deviceName"` | No | Required | Human-readable device/host name (e.g., `"Pixel 8 Pro"`, `"MacBook Pro"`) |
| `osVersion` | `String` | `string` | `"osVersion"` | No | Required | Operating system version (e.g., `"Android 15 (API 35)"`, `"macOS 15.1"`) |
| `appName` | `String` | `string` | `"appName"` | No | Required | Host application identifier or package name |
| `appVersion` | `String` | `string` | `"appVersion"` | No | Required | Host application semantic version |
| `capabilities` | `List<String>` | `string[]` | `"capabilities"` | No | `["okhttp", "ktor", "binary_preview", "redaction"]` | Supported client features |

### 3.2 Server-Enriched Model (`DeviceInfo`)
The server accepts `HelloPayload` and enriches it into `DeviceInfo` before broadcasting to the Web UI via SSE:

| Enriched Field | TypeScript Type | Assigned By | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `server.ts` | Unique session ID (e.g., `client_1_54321`) |
| `connectedAt` | `number` | `server.ts` | Server epoch timestamp when TCP socket was accepted |
| `port` | `number` | `server.ts` | Target port number |
| `clientType` | `string?` | Optional | Derived from capabilities or handshake header |

---

## 4. Network Event Models

### 4.1 `NetworkEventDto` (Kotlin Wire DTO) ⟷ `NetworkEvent` (TypeScript)

When an HTTP transaction occurs, the client dispatches a `NetworkEventDto` serialized into `payloadJson`.

#### Field Agreement Matrix

| Field | Kotlin `NetworkEventDto` | TypeScript `NetworkEventDto` | TypeScript `NetworkEvent` (Enriched) | Nullable | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | `string` | `string` | No | Unique transaction UUID (generated at request mark) |
| `timestamp` | `Long` | `number` | `number` | No | Request start timestamp in epoch ms |
| `request` | `NetworkRequestDto` | `NetworkRequestDto` | `NetworkRequest` | No | Full captured request metadata and body |
| `response` | `NetworkResponseDto?` | `NetworkResponseDto \| null` | `NetworkResponse \| null` | Yes | Null until response received |
| `durationMs` | `Long?` | `number \| null` | `number \| null` | Yes | Elapsed round-trip time in milliseconds |
| `error` | `NetworkErrorDto?` | `NetworkErrorDto \| null` | `NetworkError \| null` | Yes | Null if transaction succeeded |
| `timing` | `NetworkTimingDto?` | `NetworkTimingDto?` | `NetworkTiming?` | Yes | Granular connection & DNS timings (optional) |
| `status` | *(Server-computed)* | - | `'pending' \| 'completed' \| 'error'` | No | Added by server/UI for list badges |
| `clientId` | *(Server-computed)* | - | `string?` | Yes | Added by server: source TCP client session ID |
| `deviceName` | *(Server-computed)* | - | `string?` | Yes | Added by server: source client device name |
| `appName` | *(Server-computed)* | - | `string?` | Yes | Added by server: source client app name |
| `osVersion` | *(Server-computed)* | - | `string?` | Yes | Added by server: source client OS version |

---

### 4.2 `NetworkRequestDto` ⟷ `NetworkRequest`

| Field | Kotlin Type | TypeScript Type | JSON Key | Nullable | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `String` | `string` | `"id"` | No | Unique request ID |
| `timestamp` | `Long` | `number` | `"timestamp"` | No | Start timestamp |
| `method` | `String` | `HttpMethod \| string` | `"method"` | No | HTTP Method (`GET`, `POST`, `PUT`, `DELETE`, etc.) |
| `url` | `String` | `string` | `"url"` | No | Full target URL |
| `host` | `String` | `string` | `"host"` | No | Host domain / IP |
| `path` | `String` | `string` | `"path"` | No | Request URI path & query |
| `protocol` | `String` | `string` | `"protocol"` | No | Wire protocol (e.g., `"HTTP/1.1"`, `"h2"`, `"HTTP/2.0"`) |
| `headers` | `Map<String, String>` | `Record<string, string>` | `"headers"` | No | Redacted header map (all sensitive headers masked) |
| `body` | `PayloadDto?` | `Payload \| null` | `"body"` | Yes | Null if request has no body |
| `clientType` | `String` | `'okhttp' \| 'ktor' \| 'apollo' \| string`| `"clientType"` | No | Originating client library (`"okhttp"`, `"ktor"`, `"apollo"`) |
| `operationName` | `String?` | `string \| null` | `"operationName"` | Yes | GraphQL operation name (e.g., `"ListUsers"`, `"CreatePost"`) |
| `operationType` | `String?` | `'query' \| 'mutation' \| 'subscription' \| string \| null` | `"operationType"` | Yes | GraphQL operation type (`"query"`, `"mutation"`, `"subscription"`) |

---

### 4.3 `NetworkResponseDto` ⟷ `NetworkResponse`

| Field | Kotlin Type | TypeScript Type | JSON Key | Nullable | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `statusCode` | `Int` | `number` | `"statusCode"` | No | HTTP status code (e.g., `200`, `404`, `500`) |
| `statusMessage` | `String?` | `string \| null` | `"statusMessage"` | Yes | HTTP status message (e.g., `"OK"`, `"Not Found"`). Nullable in HTTP/2 |
| `headers` | `Map<String, String>` | `Record<string, string>` | `"headers"` | No | Redacted header map |
| `body` | `PayloadDto?` | `Payload \| null` | `"body"` | Yes | Null if response has no body |
| `durationMs` | `Long` | `number` | `"durationMs"` | No | Round-trip duration in ms |
| `sizeBytes` | `Long` | `number` | `"sizeBytes"` | No | Uncompressed response body size in bytes |
| `protocol` | `String` | `string` | `"protocol"` | No | Negotiated protocol (e.g., `"h2"`, `"HTTP/1.1"`) |

---

### 4.4 `PayloadDto` ⟷ `Payload`

Used for both Request and Response body representations.

| Field | Kotlin Type | TypeScript Type | JSON Key | Nullable | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `contentType` | `String?` | `string \| null` | `"contentType"` | Yes | MIME type (e.g., `"application/json"`, `"image/png"`) |
| `sizeBytes` | `Long` | `number` | `"sizeBytes"` | No | Total body size in bytes |
| `content` | `String?` | `string \| null` | `"content"` | Yes | UTF-8 decoded string, or null for pure binary |
| `truncated` | `Boolean` | `boolean` | `"truncated"` | No | True if payload exceeded the 64 KB safety buffer limit |
| `isBinary` | `Boolean` | `boolean` | `"isBinary"` | No | True if content is image, audio, protobuf, or non-text |
| `hexPreview` | `String?` | `string \| null` | `"hexPreview"` | Yes | Hexadecimal dump of first 256 bytes for binary payloads |

---

### 4.5 `NetworkErrorDto` ⟷ `NetworkError`

| Field | Kotlin Type | TypeScript Type | JSON Key | Nullable | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `errorType` | `String` | `string` | `"errorType"` | No | Exception class name (e.g., `"SocketTimeoutException"`, `"UnknownHostException"`) |
| `message` | `String` | `string` | `"message"` | No | Exception error message |
| `stackTrace` | `String?` | `string \| null` | `"stackTrace"` | Yes | Sanitized stack trace preview |

---

### 4.6 `NetworkTimingDto` ⟷ `NetworkTiming`

| Field | Kotlin Type | TypeScript Type | JSON Key | Nullable | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `dnsMs` | `Long?` | `number?` | `"dnsMs"` | Yes | DNS lookup duration in ms |
| `connectMs` | `Long?` | `number?` | `"connectMs"` | Yes | TCP socket connection time in ms |
| `tlsMs` | `Long?` | `number?` | `"tlsMs"` | Yes | TLS / SSL handshake duration in ms |
| `sendMs` | `Long?` | `number?` | `"sendMs"` | Yes | Time taken to transmit request headers and body |
| `waitMs` | `Long?` | `number?` | `"waitMs"` | Yes | Time to first byte (TTFB) |
| `receiveMs` | `Long?` | `number?` | `"receiveMs"` | Yes | Time taken to stream response body |

---

## 5. Mandatory Agent Change Protocol

Whenever you add, modify, or remove any field in either the Kotlin DTOs or the TypeScript definitions, you **MUST** follow this 5-step checklist:

1. **Synchronize Kotlin Multiplatform Model**:
   - File: `client/network-inspector-core/src/commonMain/kotlin/com/cacaosd/networkinspector/protocol/Protocol.kt`
   - Apply `@Serializable` annotations.
   - Maintain pure `commonMain` imports (no platform-specific Java/Android classes).

2. **Synchronize TypeScript Types**:
   - File: `src/types/inspector.ts`
   - Update matching interfaces (`WireEnvelope`, `HelloPayload`, `NetworkEventDto`, `NetworkRequestDto`, `NetworkResponseDto`, `PayloadDto`, `NetworkErrorDto`, `NetworkTimingDto`, etc.).

3. **Update Server & CLI Wire Processing (if wire frame changes)**:
   - `server.ts`: Handle new envelope types or payload parsing.
   - `desktop-cli.ts`: Update CLI renderer.

4. **Update This Agreement Document**:
   - File: `docs/DATA_MODEL_AGREEMENT.md`
   - Update the parity tables and document any new fields, nullability, or default values.

5. **Audit Parity & Validate Codebase**:
   - Verify every field in Kotlin matches TypeScript by consulting the parity matrix in `skills/data-model-agreement/SKILL.md`.
   - Run: `npm run lint` (ensure zero type errors in TypeScript).
   - Run: `npm run build` (ensure both web console and Node daemon build cleanly).
   - Build KMP libraries if Gradle is available: `./gradlew :network-inspector-core:assemble`.
   - Confirm that all checks report zero discrepancies.

---

## 6. Parity Verification Guidelines for Agents

When reviewing or executing tasks on BlameBackend:
- Use the **`data-model-agreement`** skill (`/skills/data-model-agreement/SKILL.md`) for detailed field rules.
- Check that all opcodes in `MessageType` match `WireMessageType`.
- Check that all fields in Kotlin `Protocol.kt` have exact counterparts in `src/types/inspector.ts`.
- Run `npm run lint` and `npm run build` to confirm compilation integrity across all components.
