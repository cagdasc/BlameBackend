---
name: "data-model-agreement"
description: >-
  Codifies the data model agreement and cross-platform schema contract between
  Kotlin Multiplatform (Android/iOS/Desktop/Server) and the TypeScript/Node.js host
  daemon and React Web Console. Enforces 1:1 field parity, wire envelope synchronization,
  and the mandatory update protocol to prevent data drift across client and server.
---

# Data Model Agreement & Schema Synchronization Skill

This skill defines the authoritative contract, mapping matrix, and mandatory synchronization workflows between the **Kotlin Multiplatform (KMP)** client library and the **TypeScript / Node.js** host daemon, CLI, and Web Console in **BlameBackend**.

---

## 1. When to Use This Skill

Activate and follow this skill whenever:
- Adding, renaming, or removing fields in Kotlin DTOs or TypeScript interfaces.
- Modifying wire transport logic (`WireEnvelope`, `MessageType`, serialization, or deserialization).
- Implementing new network inspection capabilities (e.g., custom headers, timing metrics, metadata flags).
- Reviewing, auditing, or fixing type discrepancies between the client and server.
- Verifying schema consistency before completing any task.

---

## 2. Dual-Source Architecture

BlameBackend relies on a synchronized dual-contract architecture:

1. **Client Contract (Kotlin Multiplatform)**:
   - Primary File: `client/network-inspector-core/src/commonMain/kotlin/com/cacaosd/networkinspector/protocol/Protocol.kt`
   - Uses `kotlinx.serialization` (`@Serializable`)
   - Strictly isolated in `commonMain` (zero platform imports)

2. **Server & Console Contract (TypeScript / Node.js)**:
   - Primary File: `src/types/inspector.ts`
   - Server Daemon: `server.ts`
   - Headless CLI: `desktop-cli.ts`
   - Terminal TUI: `src/components/TerminalTui.tsx`

3. **Wire Protocol Specification**:
   - Primary File: `docs/DATA_MODEL_AGREEMENT.md`
   - Port: `10245` (TCP)
   - Framing: Newline-delimited JSON (`\n`)

---

## 3. The 1:1 Model Mapping Matrix

| Entity | Kotlin DTO (`Protocol.kt`) | TypeScript Model (`inspector.ts`) | Wire Role |
| :--- | :--- | :--- | :--- |
| **Opcode** | `enum class MessageType` | `type WireMessageType` | Envelope message discriminator |
| **Envelope** | `data class WireEnvelope` | `interface WireEnvelope` | TCP frame wrapping payload JSON |
| **Handshake** | `data class HelloPayload` | `interface HelloPayload` | Sent once upon socket connection |
| **Event Container** | `data class NetworkEventDto` | `interface NetworkEventDto` / `NetworkEvent` | Transaction container (req + res + error) |
| **Request** | `data class NetworkRequestDto` | `interface NetworkRequest` | Captured request metadata and body |
| **Response** | `data class NetworkResponseDto` | `interface NetworkResponse` | Captured response metadata and body |
| **Body Payload** | `data class PayloadDto` | `interface Payload` | Buffered body, MIME type, truncation flag |
| **Error** | `data class NetworkErrorDto` | `interface NetworkError` | Interception exception details |
| **Timing** | `data class NetworkTimingDto` | `interface NetworkTiming` | Connection and transfer phase durations |

---

## 4. Field Agreement Reference

### 4.1 `WireEnvelope`
- `type`: `MessageType` (Kotlin) ⟷ `'HELLO' | 'NETWORK_EVENT' | 'PING' | 'PONG' | 'GOODBYE'` (TS)
- `version`: `Int` (Kotlin default: `1`) ⟷ `number` (TS)
- `timestamp`: `Long` (Kotlin epoch ms) ⟷ `number` (TS)
- `payloadJson`: `String` (Kotlin serialized inner DTO) ⟷ `string` (TS)

### 4.2 `HelloPayload`
- `deviceName`: `String` ⟷ `string`
- `osVersion`: `String` ⟷ `string`
- `appName`: `String` ⟷ `string`
- `appVersion`: `String` ⟷ `string`
- `capabilities`: `List<String>` ⟷ `string[]`

### 4.3 `NetworkRequestDto` ⟷ `NetworkRequest`
- `id`: `String` ⟷ `string`
- `timestamp`: `Long` ⟷ `number`
- `method`: `String` ⟷ `HttpMethod | string`
- `url`: `String` ⟷ `string`
- `host`: `String` ⟷ `string`
- `path`: `String` ⟷ `string`
- `protocol`: `String` ⟷ `string`
- `headers`: `Map<String, String>` ⟷ `Record<string, string>`
- `body`: `PayloadDto?` ⟷ `Payload | null`
- `clientType`: `String` ⟷ `'okhttp' | 'ktor' | string`

### 4.4 `NetworkResponseDto` ⟷ `NetworkResponse`
- `statusCode`: `Int` ⟷ `number`
- `statusMessage`: `String?` ⟷ `string | null`
- `headers`: `Map<String, String>` ⟷ `Record<string, string>`
- `body`: `PayloadDto?` ⟷ `Payload | null`
- `durationMs`: `Long` ⟷ `number`
- `sizeBytes`: `Long` ⟷ `number`
- `protocol`: `String` ⟷ `string`

### 4.5 `PayloadDto` ⟷ `Payload`
- `contentType`: `String?` ⟷ `string | null`
- `sizeBytes`: `Long` ⟷ `number`
- `content`: `String?` ⟷ `string | null`
- `truncated`: `Boolean` ⟷ `boolean`
- `isBinary`: `Boolean` ⟷ `boolean`
- `hexPreview`: `String?` ⟷ `string | null`

### 4.6 `NetworkErrorDto` ⟷ `NetworkError`
- `errorType`: `String` ⟷ `string`
- `message`: `String` ⟷ `string`
- `stackTrace`: `String?` ⟷ `string | null`

### 4.7 `NetworkTimingDto` ⟷ `NetworkTiming`
- `dnsMs`: `Long?` ⟷ `number?`
- `connectMs`: `Long?` ⟷ `number?`
- `tlsMs`: `Long?` ⟷ `number?`
- `sendMs`: `Long?` :// Long?` ⟷ `number?`
- `waitMs`: `Long?` ⟷ `number?`
- `receiveMs`: `Long?` ⟷ `number?`

---

## 5. Mandatory Agent Protocol: Update Workflow

Whenever an agent alters any data model on either side, the agent **MUST** complete these 5 steps in order:

```
[Step 1] Update Kotlin DTO
   └── File: client/network-inspector-core/src/commonMain/kotlin/.../protocol/Protocol.kt
   └── Maintain @Serializable, pure commonMain imports.

[Step 2] Update TypeScript Interface
   └── File: src/types/inspector.ts
   └── Update both raw DTO interfaces and enriched models.

[Step 3] Update Wire Handlers (if envelope or framing changes)
   └── Files: server.ts, desktop-cli.ts

[Step 4] Update Agreement Specification
   └── File: docs/DATA_MODEL_AGREEMENT.md
   └── Document newly added/modified fields, types, and nullability.

[Step 5] Verify Field-by-Field Parity & Clean Compilation
   └── Audit parity against the mapping tables in Section 4.
   └── Command: npm run lint (ensure zero TypeScript errors).
   └── Command: npm run build (ensure clean client/server bundle).
```

---

## 6. Agent Schema Parity Audit Checklist

Before declaring any data model change complete, verify each of the following points:

- [ ] **Dual Modification**: Every added, modified, or removed field in Kotlin `Protocol.kt` has an exact match in TypeScript `src/types/inspector.ts`.
- [ ] **Type Mapping Accuracy**:
  - Kotlin `String` ⟷ TypeScript `string`
  - Kotlin `Long` or `Int` ⟷ TypeScript `number`
  - Kotlin `Boolean` ⟷ TypeScript `boolean`
  - Kotlin `Map<String, String>` ⟷ TypeScript `Record<string, string>`
  - Kotlin `List<String>` ⟷ TypeScript `string[]`
- [ ] **Nullability Alignment**:
  - Kotlin nullable `T?` ⟷ TypeScript `T | null` or optional `T?`
  - Kotlin non-null `T` ⟷ TypeScript required non-null `T`
- [ ] **Wire Framing Parity**:
  - Opcode enum values in `MessageType` match `WireMessageType` union literals exactly (`HELLO`, `NETWORK_EVENT`, `PING`, `PONG`, `GOODBYE`).
  - WireEnvelope payload is always stringified JSON (`payloadJson: String` / `payloadJson: string`).
- [ ] **Documentation Parity**:
  - `docs/DATA_MODEL_AGREEMENT.md` is updated with the new or modified fields.
- [ ] **Compilation Validation**:
  - `npm run lint` finishes with zero errors.
  - `npm run build` finishes with zero errors.
