package com.cacaosd.networkinspector.okhttp

import com.cacaosd.networkinspector.core.InspectorEventBus
import com.cacaosd.networkinspector.testutil.TestHttpServer
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Duration.Companion.milliseconds

class NetworkInspectorInterceptorIntegrationTest {
    @Test
    fun capturesHttpExchangeWithoutConsumingBodiesAndRedactsCredentials() = runBlocking {
        val requestBody = """{"message":"copied"}"""
        val responseBody = """{"message":"captured"}"""
        val server = TestHttpServer(
            responseBody = responseBody,
            responseHeaders = mapOf(
                "Content-Type" to "application/json",
                "Set-Cookie" to "session=secret",
            ),
        )
        val client = OkHttpClient.Builder()
            .addInterceptor(NetworkInspectorInterceptor())
            .build()

        try {
            val expectedUrl = "http://127.0.0.1:${server.port}/body"
            val event = async(start = CoroutineStart.UNDISPATCHED) {
                withTimeout(5_000.milliseconds) {
                    InspectorEventBus.events.first {
                        it.request.url == expectedUrl && it.response != null
                    }
                }
            }
            val request = Request.Builder()
                .url(expectedUrl)
                .header("Authorization", "Bearer never-capture")
                .post(requestBody.toRequestBody("application/json".toMediaType()))
                .build()
            val response = client.newCall(request).execute()
            val captured = event.await()

            assertEquals(responseBody, response.body.string())
            assertEquals(requestBody, server.requestBody)
            assertEquals(requestBody, captured.request.body?.content)
            assertEquals("<redacted>", captured.request.headers["Authorization"])
            assertEquals(responseBody, captured.response?.body?.content)
            assertEquals("<redacted>", captured.response?.headers?.get("Set-Cookie"))
            server.awaitSuccess()
            response.close()
        } finally {
            client.dispatcher.executorService.shutdownNow()
            server.close()
        }
    }

    @Test
    fun doesNotPreReadOneShotRequestBody() = runBlocking {
        val requestBody = "streamed exactly once"
        val server = TestHttpServer(responseBody = "")
        val client = OkHttpClient.Builder()
            .addInterceptor(NetworkInspectorInterceptor())
            .build()

        try {
            val expectedUrl = "http://127.0.0.1:${server.port}/stream"
            val event = async(start = CoroutineStart.UNDISPATCHED) {
                withTimeout(5_000.milliseconds) {
                    InspectorEventBus.events.first {
                        it.request.url == expectedUrl && it.response != null
                    }
                }
            }
            val body = object : RequestBody() {
                private val bytes = requestBody.encodeToByteArray()

                override fun contentType() = "text/plain".toMediaType()

                override fun contentLength() = bytes.size.toLong()

                override fun isOneShot() = true

                override fun writeTo(sink: BufferedSink) {
                    sink.write(bytes)
                }
            }
            val request = Request.Builder().url(expectedUrl).post(body).build()
            val response = client.newCall(request).execute()
            val captured = event.await()

            server.awaitSuccess()
            assertEquals(requestBody, server.requestBody)
            assertEquals("[One-shot streaming request body]", captured.request.body?.content)
            assertEquals("", response.body.string())
            response.close()
        } finally {
            client.dispatcher.executorService.shutdownNow()
            server.close()
        }
    }
}
