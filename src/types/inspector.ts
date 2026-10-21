/**
 * BlameBackend Shared Inspector Types & Protocol Contract
 * Synchronized 1:1 with Kotlin Multiplatform `Protocol.kt`
 * See docs/DATA_MODEL_AGREEMENT.md for authoritative field-by-field parity specification.
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_INSPECTOR_PORT = 10245;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

/**
 * Wire opcode enum matching Kotlin `MessageType`
 */
export type WireMessageType =
  | 'HELLO'
  | 'NETWORK_EVENT'
  | 'PING'
  | 'PONG'
  | 'GOODBYE'
  | 'WS_OPEN'
  | 'WS_FRAME'
  | 'WS_CLOSE'
  | 'WS_ERROR'
  // Simulation variants for fine-grained internal simulator UI
  | 'NETWORK_EVENT_START'
  | 'NETWORK_EVENT_RESPONSE'
  | 'NETWORK_EVENT_ERROR';

/**
 * Top-level wire framing envelope matching Kotlin `WireEnvelope`
 */
export interface WireEnvelope<T = any> {
  type: WireMessageType;
  version: number;
  timestamp: number;
  payloadJson: string;
}

/** Legacy alias for backwards compatibility */
export type WireMessage = WireEnvelope;

/**
 * Handshake payload sent upon connection matching Kotlin `HelloPayload`
 */
export interface HelloPayload {
  deviceName: string;
  osVersion: string;
  appName: string;
  appVersion: string;
  capabilities?: string[];
}

/**
 * Body payload model matching Kotlin `PayloadDto`
 */
export interface PayloadDto {
  contentType: string | null;
  sizeBytes: number;
  content: string | null;
  truncated: boolean;
  isBinary: boolean;
  hexPreview?: string | null;
}

export type Payload = PayloadDto;

/**
 * Request DTO matching Kotlin `NetworkRequestDto`
 */
export interface NetworkRequestDto {
  id: string;
  timestamp: number;
  method: HttpMethod | string;
  url: string;
  host: string;
  path: string;
  protocol: string;
  headers: Record<string, string>;
  body: PayloadDto | null;
  clientType: 'okhttp' | 'ktor' | 'apollo' | string;
  operationName?: string | null;
  operationType?: 'query' | 'mutation' | 'subscription' | string | null;
}

export type NetworkRequest = NetworkRequestDto;

/**
 * Response DTO matching Kotlin `NetworkResponseDto`
 */
export interface NetworkResponseDto {
  statusCode: number;
  statusMessage: string | null;
  headers: Record<string, string>;
  body: PayloadDto | null;
  durationMs: number;
  sizeBytes: number;
  protocol: string;
}

export type NetworkResponse = NetworkResponseDto;

/**
 * Error DTO matching Kotlin `NetworkErrorDto`
 */
export interface NetworkErrorDto {
  errorType: string;
  message: string;
  stackTrace?: string | null;
}

export type NetworkError = NetworkErrorDto;

/**
 * Timing metrics matching Kotlin `NetworkTimingDto`
 */
export interface NetworkTimingDto {
  dnsMs?: number;
  connectMs?: number;
  tlsMs?: number;
  sendMs?: number;
  waitMs?: number;
  receiveMs?: number;
}

export type NetworkTiming = NetworkTimingDto;

/**
 * Raw wire event container matching Kotlin `NetworkEventDto`
 */
export interface NetworkEventDto {
  id: string;
  timestamp: number;
  request: NetworkRequestDto;
  response?: NetworkResponseDto | null;
  durationMs?: number | null;
  error?: NetworkErrorDto | null;
  timing?: NetworkTimingDto | null;
}

/**
 * Server-enriched event model used in React Console and SSE streams
 */
export interface NetworkEvent extends NetworkEventDto {
  request: NetworkRequest;
  response: NetworkResponse | null;
  durationMs: number | null;
  error: NetworkError | null;
  status: 'pending' | 'completed' | 'error';
  clientId?: string;
  deviceName?: string;
  appName?: string;
  osVersion?: string;
}

/**
 * Server-enriched device connection info
 */
export interface DeviceInfo extends HelloPayload {
  id?: string;
  connectedAt: number;
  port: number;
  clientType?: string;
}

/**
 * WebSocket Direction: 'tx' (outgoing client->server) or 'rx' (incoming server->client)
 */
export type WebSocketDirection = 'tx' | 'rx';

/**
 * WebSocket Frame Opcode
 */
export type WebSocketOpcode = 'text' | 'binary' | 'ping' | 'pong' | 'close';

/**
 * WebSocket frame matching Kotlin `WebSocketFrameDto`
 */
export interface WebSocketFrameDto {
  id: string;
  connectionId: string;
  timestamp: number;
  direction: WebSocketDirection;
  opcode: WebSocketOpcode;
  payload: PayloadDto;
}

export type WebSocketFrame = WebSocketFrameDto;

/**
 * WebSocket connection metadata matching Kotlin `WebSocketConnectionDto`
 */
export interface WebSocketConnectionDto {
  id: string;
  timestamp: number;
  url: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  clientType: 'okhttp' | 'ktor' | string;
  status: 'connecting' | 'open' | 'closed' | 'error';
  closeCode?: number | null;
  closeReason?: string | null;
  error?: NetworkErrorDto | null;
  totalTxFrames?: number;
  totalRxFrames?: number;
  totalTxBytes?: number;
  totalRxBytes?: number;
  durationMs?: number | null;
}

/**
 * Server-enriched WebSocket session with frame buffer
 */
export interface WebSocketConnection extends WebSocketConnectionDto {
  frames: WebSocketFrameDto[];
  clientId?: string;
  deviceName?: string;
  appName?: string;
  osVersion?: string;
}

export interface FilterCriteria {
  raw: string;
  host?: string;
  method?: string;
  status?: string;
  device?: string;
  protocol?: string;
  search?: string;
  operation?: string;
  operationType?: string;
  isGraphQl?: boolean;
  hasGraphQlError?: boolean;
  isWebSocket?: boolean;
  wsDirection?: 'tx' | 'rx';
  wsOpcode?: string;
  protocolType?: 'all' | 'http' | 'graphql' | 'websocket';
}
