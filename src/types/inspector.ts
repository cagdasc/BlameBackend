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
}
