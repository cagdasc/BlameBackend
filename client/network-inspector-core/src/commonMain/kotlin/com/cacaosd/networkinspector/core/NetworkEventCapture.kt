package com.cacaosd.networkinspector.core

import com.cacaosd.networkinspector.protocol.NetworkErrorDto
import com.cacaosd.networkinspector.protocol.NetworkEventDto
import com.cacaosd.networkinspector.protocol.NetworkRequestDto
import com.cacaosd.networkinspector.protocol.NetworkResponseDto
import com.cacaosd.networkinspector.protocol.PayloadDto
import kotlin.random.Random
import kotlin.time.Clock
import kotlin.time.TimeMark
import kotlin.time.TimeSource

class NetworkEventCapture(
    method: String,
    url: String,
    host: String,
    path: String,
    protocol: String,
    headers: Map<String, String>,
    clientType: String,
    operationName: String? = null,
    operationType: String? = null,
) {
    private val startTime: TimeMark = TimeSource.Monotonic.markNow()
    private val timestamp = Clock.System.now().toEpochMilliseconds()

    var request: NetworkRequestDto = NetworkRequestDto(
        id = Random.nextBytes(16).joinToString("") { byte ->
            (byte.toInt() and 0xff).toString(16).padStart(2, '0')
        },
        timestamp = timestamp,
        method = method,
        url = url,
        host = host,
        path = path,
        protocol = protocol,
        headers = InspectorEventBus.redactor.redact(headers),
        clientType = clientType,
        operationName = operationName,
        operationType = operationType,
    )
        private set

    fun requestEvent(): NetworkEventDto = NetworkEventDto(
        id = request.id,
        timestamp = request.timestamp,
        request = request,
    )

    fun updateRequestBody(body: PayloadDto): NetworkEventDto {
        request = request.copy(body = body)
        return requestEvent()
    }

    fun updateGraphQlDetails(
        operationName: String? = null,
        operationType: String? = null,
        body: PayloadDto? = null,
    ): NetworkEventDto {
        request = request.copy(
            operationName = operationName ?: request.operationName,
            operationType = operationType ?: request.operationType,
            body = body ?: request.body,
        )
        return requestEvent()
    }

    fun responseEvent(
        statusCode: Int,
        statusMessage: String?,
        headers: Map<String, String>,
        body: PayloadDto?,
        sizeBytes: Long,
        protocol: String,
        error: NetworkErrorDto? = null,
    ): NetworkEventDto {
        val durationMs = startTime.elapsedNow().inWholeMilliseconds
        return NetworkEventDto(
            id = request.id,
            timestamp = request.timestamp,
            request = request,
            response = NetworkResponseDto(
                statusCode = statusCode,
                statusMessage = statusMessage,
                headers = InspectorEventBus.redactor.redact(headers),
                body = body,
                durationMs = durationMs,
                sizeBytes = sizeBytes,
                protocol = protocol,
            ),
            durationMs = durationMs,
            error = error,
        )
    }

    fun errorEvent(errorType: String, message: String): NetworkEventDto {
        val durationMs = startTime.elapsedNow().inWholeMilliseconds
        return NetworkEventDto(
            id = request.id,
            timestamp = request.timestamp,
            request = request,
            durationMs = durationMs,
            error = NetworkErrorDto(
                errorType = errorType,
                message = message,
            ),
        )
    }
}
