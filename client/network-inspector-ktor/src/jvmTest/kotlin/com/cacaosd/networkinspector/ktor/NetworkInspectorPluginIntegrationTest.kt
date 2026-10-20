package com.cacaosd.networkinspector.ktor

import com.cacaosd.networkinspector.core.InspectorEventBus
import com.cacaosd.networkinspector.testutil.TestHttpServer
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Duration.Companion.milliseconds

class NetworkInspectorPluginIntegrationTest {
    @Test
    fun capturesRequestAndResponseWhilePreservingBothBodies() = runBlocking {
        val requestBody = """{"message":"copied"}"""
        val responseBody = """{"message":"captured"}"""
        val server = TestHttpServer(
            responseBody = responseBody,
            responseHeaders = mapOf(
                "Content-Type" to "application/json",
                "Set-Cookie" to "session=secret",
            ),
        )
        val client = HttpClient(CIO) {
            install(NetworkInspectorPlugin)
        }

        try {
            val expectedUrl = "http://127.0.0.1:${server.port}/body"
            val event = async(start = CoroutineStart.UNDISPATCHED) {
                withTimeout(5_000.milliseconds) {
                    InspectorEventBus.events.first {
                        it.request.url == expectedUrl && it.response != null
                    }
                }
            }
            val response = client.post(expectedUrl) {
                header(HttpHeaders.Authorization, "Bearer never-capture")
                contentType(ContentType.Application.Json)
                setBody(requestBody)
            }

            assertEquals(responseBody, response.bodyAsText())
            server.awaitSuccess()
            assertEquals(requestBody, server.requestBody)
            val captured = event.await()
            assertEquals(requestBody, captured.request.body?.content)
            assertEquals("<redacted>", captured.request.headers[HttpHeaders.Authorization])
            assertEquals(responseBody, captured.response?.body?.content)
            assertEquals("<redacted>", captured.response?.headers?.get(HttpHeaders.SetCookie))
        } finally {
            client.close()
            server.close()
        }
    }

    @Test
    fun capturesHttpFailureAsAnErrorEvent() = runBlocking {
        val server = TestHttpServer(responseBody = "", statusLine = "404 Not Found")
        val client = HttpClient(CIO) {
            install(NetworkInspectorPlugin)
        }

        try {
            val expectedUrl = "http://127.0.0.1:${server.port}/missing"
            val event = async(start = CoroutineStart.UNDISPATCHED) {
                withTimeout(5_000.milliseconds) {
                    InspectorEventBus.events.first {
                        it.request.url == expectedUrl && it.response != null
                    }
                }
            }

            client.get(expectedUrl)
            val captured = event.await()

            server.awaitSuccess()
            assertEquals(404, captured.response?.statusCode)
            assertEquals("HttpStatus", captured.error?.errorType)
            assertEquals("HTTP 404 Not Found", captured.error?.message)
        } finally {
            client.close()
            server.close()
        }
    }
}
