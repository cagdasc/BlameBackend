package com.cacaosd.networkinspector.ktor

import com.cacaosd.networkinspector.core.InspectorEventBus
import com.cacaosd.networkinspector.core.NetworkEventCapture
import com.cacaosd.networkinspector.core.PayloadUtils
import com.cacaosd.networkinspector.protocol.NetworkErrorDto
import com.cacaosd.networkinspector.protocol.PayloadDto
import io.ktor.client.call.body
import io.ktor.client.call.save
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.http.HttpHeaders
import io.ktor.http.content.OutgoingContent
import io.ktor.util.AttributeKey

private data class RequestMetadata(
    val capture: NetworkEventCapture,
)

private val RequestMetadataKey = AttributeKey<RequestMetadata>("NetworkInspectorRequestMetadata")

/**
 * Captures Ktor request and response metadata and sends it to the inspector event stream.
 * Repeatable request bodies are copied for capture, and response bodies are saved before
 * capture so application code can still read them.
 */
val NetworkInspectorPlugin = createClientPlugin("NetworkInspector") {
    onRequest { request, _ ->
        val url = request.url.build()
        val headers = request.headers.entries().associate { (name, values) ->
            name to values.joinToString(", ")
        }
        val capture = NetworkEventCapture(
            method = request.method.value,
            url = url.toString(),
            host = url.host,
            path = url.encodedPath,
            protocol = "",
            headers = headers,
            clientType = "ktor",
        )
        request.attributes.put(RequestMetadataKey, RequestMetadata(capture))
        InspectorEventBus.dispatch(capture.requestEvent())
    }

    transformRequestBody { request, content, _ ->
        val metadata = request.attributes.getOrNull(RequestMetadataKey) ?: return@transformRequestBody null

        val payload = captureRequestBody(
            body = content,
            contentType = request.headers[HttpHeaders.ContentType],
        )
        if (payload != null) {
            InspectorEventBus.dispatch(metadata.capture.updateRequestBody(payload))
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
        val statusCode = response.status.value

        val error = if (statusCode >= 400) {
            NetworkErrorDto(
                errorType = "HttpStatus",
                message = "HTTP $statusCode ${response.status.description}".trim(),
            )
        } else {
            null
        }

        InspectorEventBus.dispatch(
            metadata.capture.responseEvent(
                statusCode = statusCode,
                statusMessage = response.status.description,
                headers = responseHeaders,
                body = responsePayload,
                sizeBytes = responsePayload.sizeBytes,
                protocol = response.version.toString(),
                error = error,
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
