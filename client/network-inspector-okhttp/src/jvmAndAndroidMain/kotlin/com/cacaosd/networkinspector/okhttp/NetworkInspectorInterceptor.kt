package com.cacaosd.networkinspector.okhttp

import com.cacaosd.networkinspector.core.InspectorEventBus
import com.cacaosd.networkinspector.core.NetworkEventCapture
import com.cacaosd.networkinspector.core.PayloadUtils
import com.cacaosd.networkinspector.protocol.PayloadDto
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import okio.Buffer

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

        // 1. Capture Request metadata safely
        val requestHeaders = request.headers.toMap()
        val capture = NetworkEventCapture(
            method = request.method,
            url = request.url.toString(),
            host = request.url.host,
            path = request.url.encodedPath + if (request.url.encodedQuery != null) "?${request.url.encodedQuery}" else "",
            protocol = "",
            headers = requestHeaders,
            clientType = "okhttp",
        )
        // Non-destructively buffer request body if present
        val requestPayload = captureRequestBody(request)
        val requestEvent = requestPayload?.let(capture::updateRequestBody) ?: capture.requestEvent()

        // Dispatch initial event
        InspectorEventBus.dispatch(requestEvent)

        // 2. Proceed with real network chain
        val response: Response
        try {
            response = chain.proceed(request)
        } catch (e: Exception) {
            InspectorEventBus.dispatch(
                capture.errorEvent(
                    errorType = e::class.simpleName ?: "NetworkException",
                    message = e.message ?: "Network error during call",
                )
            )
            throw e
        }

        // 3. Capture Response metadata safely
        val responseHeaders = response.headers.toMap()
        // Use response.peekBody to avoid exhausting the response body stream
        val responsePayload = captureResponseBody(response)
        InspectorEventBus.dispatch(
            capture.responseEvent(
                statusCode = response.code,
                statusMessage = response.message,
                headers = responseHeaders,
                body = responsePayload,
                sizeBytes = responsePayload?.sizeBytes ?: response.body.contentLength(),
                protocol = response.protocol.toString(),
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
