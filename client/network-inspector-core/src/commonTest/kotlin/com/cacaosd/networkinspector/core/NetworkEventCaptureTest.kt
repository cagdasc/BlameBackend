package com.cacaosd.networkinspector.core

import com.cacaosd.networkinspector.protocol.PayloadDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class NetworkEventCaptureTest {
    @Test
    fun requestBodyAndResponseEventsRetainRequestIdentityAndRedactHeaders() {
        val capture = NetworkEventCapture(
            method = "POST",
            url = "https://example.test/items",
            host = "example.test",
            path = "/items",
            protocol = "HTTP/1.1",
            headers = mapOf("Authorization" to "secret", "Accept" to "application/json"),
            clientType = "ktor",
        )
        val differentCapture = NetworkEventCapture(
            method = "GET",
            url = "https://example.test/",
            host = "example.test",
            path = "/",
            protocol = "HTTP/1.1",
            headers = emptyMap(),
            clientType = "ktor",
        )
        val initial = capture.requestEvent()
        val payload = PayloadDto(
            contentType = "text/plain",
            sizeBytes = 4,
            content = "body",
            truncated = false,
            isBinary = false,
        )

        val bodyEvent = capture.updateRequestBody(payload)
        val responseEvent = capture.responseEvent(
            statusCode = 201,
            statusMessage = "Created",
            headers = mapOf("Set-Cookie" to "session=secret"),
            body = payload,
            sizeBytes = payload.sizeBytes,
            protocol = "HTTP/1.1",
        )

        assertEquals(32, initial.id.length)
        assertNotEquals(initial.id, differentCapture.requestEvent().id)
        assertEquals(initial.id, bodyEvent.id)
        assertEquals(initial.timestamp, bodyEvent.timestamp)
        assertEquals(payload, bodyEvent.request.body)
        assertEquals("<redacted>", initial.request.headers["Authorization"])
        assertEquals("<redacted>", responseEvent.response?.headers?.get("Set-Cookie"))
        assertEquals(201, responseEvent.response?.statusCode)
        assertEquals(initial.id, responseEvent.request.id)
        assertTrue(assertNotNull(responseEvent.durationMs) >= 0)
    }

    @Test
    fun networkErrorsAreAssociatedWithRequestAndHaveDuration() {
        val capture = NetworkEventCapture(
            method = "GET",
            url = "https://example.test/",
            host = "example.test",
            path = "/",
            protocol = "HTTP/1.1",
            headers = emptyMap(),
            clientType = "okhttp",
        )

        val event = capture.errorEvent("IOException", "Connection refused")

        assertEquals(capture.request.id, event.id)
        assertEquals("IOException", event.error?.errorType)
        assertEquals("Connection refused", event.error?.message)
        assertTrue(assertNotNull(event.durationMs) >= 0)
    }
}
