package com.cacaosd.networkinspector.protocol

import kotlinx.serialization.Serializable
import kotlin.time.Clock

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

@Serializable
data class HelloPayload(
    val deviceName: String,
    val osVersion: String,
    val appName: String,
    val appVersion: String,
    val capabilities: List<String> = listOf("okhttp", "ktor", "binary_preview", "redaction")
)

@Serializable
data class NetworkEventDto(
    val id: String,
    val timestamp: Long,
    val request: NetworkRequestDto,
    val response: NetworkResponseDto? = null,
    val durationMs: Long? = null,
    val error: NetworkErrorDto? = null,
    val timing: NetworkTimingDto? = null
)

@Serializable
data class NetworkRequestDto(
    val id: String,
    val timestamp: Long,
    val method: String,
    val url: String,
    val host: String,
    val path: String,
    val protocol: String,
    val headers: Map<String, String>,
    val body: PayloadDto? = null,
    val clientType: String
)

@Serializable
data class NetworkResponseDto(
    val statusCode: Int,
    val statusMessage: String?,
    val headers: Map<String, String>,
    val body: PayloadDto? = null,
    val durationMs: Long,
    val sizeBytes: Long,
    val protocol: String
)

@Serializable
data class PayloadDto(
    val contentType: String?,
    val sizeBytes: Long,
    val content: String?,
    val truncated: Boolean,
    val isBinary: Boolean,
    val hexPreview: String? = null
)

@Serializable
data class NetworkErrorDto(
    val errorType: String,
    val message: String,
    val stackTrace: String? = null
)

@Serializable
data class NetworkTimingDto(
    val dnsMs: Long? = null,
    val connectMs: Long? = null,
    val tlsMs: Long? = null,
    val sendMs: Long? = null,
    val waitMs: Long? = null,
    val receiveMs: Long? = null
)