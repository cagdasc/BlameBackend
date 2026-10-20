package com.cacaosd.networkinspector.apollo

import com.apollographql.apollo.api.http.HttpMethod
import com.apollographql.apollo.api.http.HttpRequest
import com.apollographql.apollo.api.http.HttpResponse
import com.apollographql.apollo.network.http.HttpInterceptor
import com.apollographql.apollo.network.http.HttpInterceptorChain
import com.cacaosd.networkinspector.core.InspectorEventBus
import com.cacaosd.networkinspector.core.NetworkEventCapture
import com.cacaosd.networkinspector.protocol.NetworkErrorDto
import com.cacaosd.networkinspector.protocol.PayloadDto

/**
 * Captures Apollo GraphQL HTTP traffic in the inspector event stream.
 *
 * Add this interceptor with `ApolloClient.Builder.addHttpInterceptor`.
 */
class NetworkInspectorApolloInterceptor(
    private val config: NetworkInspectorApolloConfig = NetworkInspectorApolloConfig(),
) : HttpInterceptor {
    override suspend fun intercept(
        request: HttpRequest,
        chain: HttpInterceptorChain,
    ): HttpResponse {
        val safeUrl = ApolloUrlSanitizer.sanitize(request.url)

        val headerOpName = request.headers.firstOrNull {
            it.name.equals("X-APOLLO-OPERATION-NAME", ignoreCase = true)
        }?.value
        val urlMetadata = if (request.method == HttpMethod.Get) {
            ApolloGraphQlPayloadCapture.extractOperationMetadataFromUrl(request.url)
        } else null

        val bodyByteMetadata = (request.body as? com.apollographql.apollo.api.http.ByteStringHttpBody)?.let {
            ApolloGraphQlPayloadCapture.extractOperationMetadata(it.byteString.toByteArray())
        }

        val initialOpName = headerOpName ?: urlMetadata?.operationName ?: bodyByteMetadata?.operationName
        val initialOpType = urlMetadata?.operationType ?: bodyByteMetadata?.operationType

        val capture = NetworkEventCapture(
            method = request.method.name.uppercase(),
            url = safeUrl,
            host = safeUrl.substringAfter("://").substringBefore('/'),
            path = safeUrl.substringAfter("://").substringAfter('/', ""),
            protocol = "",
            headers = request.headers.toHeaderMap(),
            clientType = "apollo",
            operationName = initialOpName,
            operationType = initialOpType,
        )
        InspectorEventBus.dispatch(capture.requestEvent())
        val inspectedRequest = inspectRequest(request, capture)

        val response = try {
            chain.proceed(inspectedRequest)
        } catch (error: Exception) {
            InspectorEventBus.dispatch(
                capture.errorEvent(
                    errorType = error::class.simpleName ?: "GraphQLNetworkException",
                    message = "GraphQL HTTP request failed",
                )
            )
            throw error
        }

        val statusError = response.statusError()
        if (!config.captureResponseBody || response.body == null) {
            dispatchResponse(capture, response, body = null, error = statusError)
            return response
        }

        return CapturingApolloResponse.wrap(response, config) { body, size ->
            dispatchResponse(capture, response, body, statusError, size)
        }
    }

    private fun inspectRequest(
        request: HttpRequest,
        capture: NetworkEventCapture,
    ): HttpRequest {
        val body = request.body
        if (body == null) {
            if (request.method == HttpMethod.Get) {
                val metadata = ApolloGraphQlPayloadCapture.extractOperationMetadataFromUrl(request.url)
                val payload = ApolloGraphQlPayloadCapture.getRequest(request.url, config)
                InspectorEventBus.dispatch(
                    capture.updateGraphQlDetails(
                        operationName = metadata.operationName,
                        operationType = metadata.operationType,
                        body = payload,
                    )
                )
            }
            return request
        }

        return request.newBuilder()
            .body(
                CapturingApolloHttpBody(body, config.captureLimit) { bytes, size ->
                    val metadata = ApolloGraphQlPayloadCapture.extractOperationMetadata(bytes)
                    val payload = ApolloGraphQlPayloadCapture.requestBody(bytes, size, body.contentType, config)
                    InspectorEventBus.dispatch(
                        capture.updateGraphQlDetails(
                            operationName = metadata.operationName,
                            operationType = metadata.operationType,
                            body = payload,
                        )
                    )
                }
            )
            .build()
    }

    private fun HttpResponse.statusError(): NetworkErrorDto? =
        if (statusCode >= 400) {
            NetworkErrorDto(errorType = "HttpStatus", message = "HTTP $statusCode")
        } else {
            null
        }

    private fun dispatchResponse(
        capture: NetworkEventCapture,
        response: HttpResponse,
        body: PayloadDto?,
        error: NetworkErrorDto?,
        size: Long = response.headers.contentLength(),
    ) {
        InspectorEventBus.dispatch(
            capture.responseEvent(
                statusCode = response.statusCode,
                statusMessage = null,
                headers = response.headers.toHeaderMap(),
                body = body,
                sizeBytes = size,
                protocol = "",
                error = error,
            )
        )
    }
}
