package com.cacaosd.networkinspector.okhttp

import com.cacaosd.networkinspector.core.InspectorEventBus
import com.cacaosd.networkinspector.core.PayloadUtils
import com.cacaosd.networkinspector.protocol.NetworkErrorDto
import com.cacaosd.networkinspector.protocol.NetworkEventDto
import com.cacaosd.networkinspector.protocol.NetworkRequestDto
import com.cacaosd.networkinspector.protocol.NetworkResponseDto
import com.cacaosd.networkinspector.protocol.PayloadDto
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import okio.Buffer
import kotlin.random.Random
import kotlin.time.Clock
import kotlin.time.TimeSource

/**
 * OkHttp Interceptor for Network Inspector.
 *
 * Rules strictly followed:
 * 1. Never consumes request or response bodies destructively.
 * 2. Never alters original request semantics.
 * 3. Catches and reports request exceptions without swallowing them.
 * 4. Redacts sensitive authentication tokens and cookies.
 */
class NetworkInspectorInterceptor : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val requestId = Random.nextBytes(16).joinToString("") { byte ->
            (byte.toInt() and 0xff).toString(16).padStart(2, '0')
        }
        val startTime = TimeSource.Monotonic.markNow()
        val timestamp = Clock.System.now().toEpochMilliseconds()

        // 1. Capture Request metadata safely
        val requestHeaders = mutableMapOf<String, String>()
        for (i in 0 until request.headers.size) {
            requestHeaders[request.headers.name(i)] = request.headers.value(i)
        }
        val safeRequestHeaders = InspectorEventBus.redactor.redact(requestHeaders)

        // Non-destructively buffer request body if present
        val requestPayload = captureRequestBody(request)

        val requestDto = NetworkRequestDto(
            id = requestId,
            timestamp = timestamp,
            method = request.method,
            url = request.url.toString(),
            host = request.url.host,
            path = request.url.encodedPath + if (request.url.encodedQuery != null) "?${request.url.encodedQuery}" else "",
            protocol = "HTTP/2.0",
            headers = safeRequestHeaders,
            body = requestPayload,
            clientType = "okhttp"
        )

        // Dispatch initial event
        InspectorEventBus.dispatch(
            NetworkEventDto(
                id = requestId,
                timestamp = timestamp,
                request = requestDto
            )
        )

        // 2. Proceed with real network chain
        val response: Response
        try {
            response = chain.proceed(request)
        } catch (e: Exception) {
            val durationMs = startTime.elapsedNow().inWholeMilliseconds
            InspectorEventBus.dispatch(
                NetworkEventDto(
                    id = requestId,
                    timestamp = timestamp,
                    request = requestDto,
                    durationMs = durationMs,
                    error = NetworkErrorDto(
                        errorType = e::class.simpleName ?: "NetworkException",
                        message = e.message ?: "Network error during call",
                    )
                )
            )
            throw e
        }

        // 3. Capture Response metadata safely
        val durationMs = startTime.elapsedNow().inWholeMilliseconds
        val responseHeaders = mutableMapOf<String, String>()
        for (i in 0 until response.headers.size) {
            responseHeaders[response.headers.name(i)] = response.headers.value(i)
        }
        val safeResponseHeaders = InspectorEventBus.redactor.redact(responseHeaders)

        // Use response.peekBody to avoid exhausting the response body stream
        val responsePayload = captureResponseBody(response)

        val responseDto = NetworkResponseDto(
            statusCode = response.code,
            statusMessage = response.message,
            headers = safeResponseHeaders,
            body = responsePayload,
            durationMs = durationMs,
            sizeBytes = responsePayload?.sizeBytes ?: response.body.contentLength(),
            protocol = response.protocol.toString()
        )

        InspectorEventBus.dispatch(
            NetworkEventDto(
                id = requestId,
                timestamp = timestamp,
                request = requestDto.copy(protocol = response.protocol.toString()),
                response = responseDto,
                durationMs = durationMs
            )
        )

        return response
    }

    private fun captureRequestBody(request: Request): PayloadDto? {
        val body = request.body ?: return null
        if (body.isOneShot()) {
            return PayloadDto(
                contentType = body.contentType()?.toString(),
                sizeBytes = body.contentLength(),
                content = "[One-shot streaming request body]",
                truncated = false,
                isBinary = false
            )
        }

        return runCatching {
            val buffer = Buffer()
            body.writeTo(buffer)
            val bytes = buffer.readByteArray()
            PayloadUtils.createPayload(
                bytes = bytes,
                contentType = body.contentType()?.toString(),
                maxSizeBytes = InspectorEventBus.maxBodySizeBytes
            )
        }.getOrNull()
    }

    private fun captureResponseBody(response: Response): PayloadDto? {
        val body = response.body
        val contentType = body.contentType()?.toString()

        return runCatching {
            // Peek up to configured limit without consuming original source
            val peek = response.peekBody(InspectorEventBus.maxBodySizeBytes + 1)
            val bytes = peek.bytes()
            PayloadUtils.createPayload(
                bytes = bytes,
                contentType = contentType,
                maxSizeBytes = InspectorEventBus.maxBodySizeBytes
            )
        }.getOrNull()
    }
}
