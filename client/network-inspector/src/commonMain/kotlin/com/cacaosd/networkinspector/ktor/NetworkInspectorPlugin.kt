package com.cacaosd.networkinspector.ktor

import com.cacaosd.networkinspector.core.InspectorEventBus
import com.cacaosd.networkinspector.core.PayloadUtils
import com.cacaosd.networkinspector.protocol.NetworkErrorDto
import com.cacaosd.networkinspector.protocol.NetworkEventDto
import com.cacaosd.networkinspector.protocol.NetworkRequestDto
import com.cacaosd.networkinspector.protocol.NetworkResponseDto
import com.cacaosd.networkinspector.protocol.PayloadDto
import io.ktor.client.call.body
import io.ktor.client.call.save
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.http.HttpHeaders
import io.ktor.http.content.OutgoingContent
import io.ktor.util.AttributeKey
import kotlin.random.Random
import kotlin.time.Clock
import kotlin.time.TimeMark
import kotlin.time.TimeSource

private data class RequestMetadata(
    var request: NetworkRequestDto,
    val startTime: TimeMark,
)

private val RequestMetadataKey = AttributeKey<RequestMetadata>("NetworkInspectorRequestMetadata")

/**
 * Captures Ktor request and response metadata and sends it to the inspector event stream.
 * Repeatable request bodies are copied for capture, and response bodies are saved before
 * capture so application code can still read them.
 */
val NetworkInspectorPlugin = createClientPlugin("NetworkInspector") {
    onRequest { request, _ ->
        val id = Random.nextBytes(16).joinToString("") { byte ->
            (byte.toInt() and 0xff).toString(16).padStart(2, '0')
        }
        val timestamp = Clock.System.now().toEpochMilliseconds()
        val url = request.url.build()

        val headers = request.headers.entries().associate { (name, values) ->
            name to values.joinToString(", ")
        }
        val metadata = RequestMetadata(
            request = NetworkRequestDto(
                id = id,
                timestamp = timestamp,
                method = request.method.value,
                url = url.toString(),
                host = url.host,
                path = url.encodedPath,
                protocol = "HTTP",
                headers = InspectorEventBus.redactor.redact(headers),
                clientType = "ktor",
            ),
            startTime = TimeSource.Monotonic.markNow(),
        )
        request.attributes.put(RequestMetadataKey, metadata)
        InspectorEventBus.dispatch(
            NetworkEventDto(
                id = id,
                timestamp = timestamp,
                request = metadata.request,
            )
        )
    }

    transformRequestBody { request, content, _ ->
        val metadata = request.attributes.getOrNull(RequestMetadataKey) ?: return@transformRequestBody null

        val payload = captureRequestBody(
            body = content,
            contentType = request.headers[HttpHeaders.ContentType],
        )
        if (payload != null) {
            metadata.request = metadata.request.copy(body = payload)
            InspectorEventBus.dispatch(
                NetworkEventDto(
                    id = metadata.request.id,
                    timestamp = metadata.request.timestamp,
                    request = metadata.request,
                )
            )
        }
        null
    }

    onResponse { response ->
        val metadata = response.call.request.attributes.getOrNull(RequestMetadataKey)
            ?: return@onResponse
        val responseHeaders = response.headers.entries().associate { (name, values) ->
            name to values.joinToString(", ")
        }
        val savedResponse = response.call.save().response
        val responseBody = savedResponse.body<ByteArray>()
        val responsePayload = PayloadUtils.createPayload(
            bytes = responseBody,
            contentType = response.headers[HttpHeaders.ContentType],
            maxSizeBytes = InspectorEventBus.maxBodySizeBytes,
        )
        val durationMs = metadata.startTime.elapsedNow().inWholeMilliseconds
        val statusCode = response.status.value

        val protocol = response.version.toString()

        InspectorEventBus.dispatch(
            NetworkEventDto(
                id = metadata.request.id,
                timestamp = metadata.request.timestamp,
                request = metadata.request.copy(protocol = protocol),
                response = NetworkResponseDto(
                    statusCode = statusCode,
                    statusMessage = response.status.description,
                    headers = InspectorEventBus.redactor.redact(responseHeaders),
                    body = responsePayload,
                    durationMs = durationMs,
                    sizeBytes = responsePayload.sizeBytes,
                    protocol = protocol,
                ),
                durationMs = durationMs,
                error = if (statusCode >= 400) {
                    NetworkErrorDto(
                        errorType = "HttpStatus",
                        message = "HTTP $statusCode ${response.status.description}".trim(),
                    )
                } else {
                    null
                },
            )
        )
    }
}

private fun captureRequestBody(
    body: Any,
    contentType: String? = null,
): PayloadDto? {
    var bodyContentType = contentType
    val bytes = when (body) {
        is OutgoingContent.ByteArrayContent -> {
            bodyContentType = body.contentType?.toString() ?: bodyContentType
            body.bytes().copyOf()
        }

        is ByteArray -> body.copyOf()
        is String -> body.encodeToByteArray()
        else -> return null
    }

    return PayloadUtils.createPayload(
        bytes = bytes,
        contentType = bodyContentType,
        maxSizeBytes = InspectorEventBus.maxBodySizeBytes,
    )
}
