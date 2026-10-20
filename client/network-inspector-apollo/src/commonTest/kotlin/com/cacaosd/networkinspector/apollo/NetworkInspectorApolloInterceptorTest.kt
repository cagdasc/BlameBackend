package com.cacaosd.networkinspector.apollo

import com.apollographql.apollo.api.http.ByteStringHttpBody
import com.apollographql.apollo.api.http.HttpMethod
import com.apollographql.apollo.api.http.HttpRequest
import com.apollographql.apollo.api.http.HttpResponse
import com.apollographql.apollo.network.http.HttpInterceptorChain
import com.cacaosd.networkinspector.core.InspectorEventBus
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okio.Buffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

class NetworkInspectorApolloInterceptorTest {
    @Test
    fun capturesGraphQlAndRedactsSensitiveValuesWithoutChangingBodies() = runBlocking {
        val url = "https://user:password@example.test/graphql?access_token=url-secret"
        val requestBody = """
            {"operationName":"LookupUser","query":"query LookupUser(${'$'}id: ID!) { user(id: ${'$'}id) { id name } }","variables":{"id":"user-1","password":"secret-password","nested":{"accessToken":"access-secret"}}}
        """.trimIndent()
        val responseBody = """{"data":{"user":{"name":"Ada","accessToken":"response-secret"}}}"""
        val interceptor = NetworkInspectorApolloInterceptor(
            NetworkInspectorApolloConfig(
                captureQuery = true,
                captureVariables = true,
                captureResponseBody = true,
            )
        )
        val event = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(5_000) {
                InspectorEventBus.events.first {
                    it.request.url == "https://example.test/graphql" && it.response != null
                }
            }
        }

        val response = interceptor.intercept(
            HttpRequest.Builder(HttpMethod.Post, url)
                .addHeader("X-Auth-Token", "header-secret")
                .body(ByteStringHttpBody("application/json", requestBody))
                .build(),
            object : HttpInterceptorChain {
                override suspend fun proceed(request: HttpRequest): HttpResponse {
                    val sentBody = Buffer()
                    request.body!!.writeTo(sentBody)
                    assertEquals(requestBody, sentBody.readUtf8())
                    return HttpResponse.Builder(200)
                        .addHeader("Content-Type", "application/json")
                        .body(Buffer().writeUtf8(responseBody))
                        .build()
                }
            },
        )

        assertEquals(responseBody, response.body!!.readUtf8())
        val captured = event.await()
        val requestPayload = assertNotNull(captured.request.body).content.orEmpty()
        val responsePayload = assertNotNull(captured.response?.body).content.orEmpty()

        assertEquals("LookupUser", captured.request.operationName)
        assertEquals("query", captured.request.operationType)
        assertTrue(requestPayload.contains("LookupUser"))
        assertTrue(requestPayload.contains("user-1"))
        assertTrue(requestPayload.contains("<redacted>"))
        assertFalse(requestPayload.contains("secret-password"))
        assertFalse(requestPayload.contains("access-secret"))
        assertEquals("<redacted>", captured.request.headers["X-Auth-Token"])
        assertFalse(captured.request.url.contains("password"))
        assertFalse(captured.request.url.contains("url-secret"))
        assertTrue(responsePayload.contains("Ada"))
        assertTrue(responsePayload.contains("<redacted>"))
        assertFalse(responsePayload.contains("response-secret"))
    }

    @Test
    fun omitsInlineSensitiveQueryAndDefaultsToMetadataOnly() = runBlocking {
        val url = "https://example.test/graphql"
        val interceptor = NetworkInspectorApolloInterceptor()
        val event = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(5_000) {
                InspectorEventBus.events.first {
                    it.request.url == url && it.response != null
                }
            }
        }

        val response = interceptor.intercept(
            HttpRequest.Builder(HttpMethod.Post, url)
                .body(
                    ByteStringHttpBody(
                        "application/json",
                        """{"operationName":"Unsafe","query":"mutation { login(password: \"literal-secret\") }","variables":{"password":"variable-secret"}}""",
                    )
                )
                .build(),
            object : HttpInterceptorChain {
                override suspend fun proceed(request: HttpRequest): HttpResponse {
                    val sink = Buffer()
                    request.body!!.writeTo(sink)
                    return HttpResponse.Builder(200).build()
                }
            },
        )

        val captured = event.await()
        val requestPayload = assertNotNull(captured.request.body).content.orEmpty()
        assertTrue(requestPayload.contains("Unsafe"))
        assertFalse(requestPayload.contains("literal-secret"))
        assertFalse(requestPayload.contains("variable-secret"))
        assertEquals(null, captured.response?.body)
        assertEquals(200, captured.response?.statusCode)
        assertEquals(null, response.body)
    }

    @Test
    fun capturesGetOperationMetadataWithoutLeakingUrlVariables() = runBlocking {
        val url =
            "https://example.test/graphql?operationName=GetUsers&query=query+GetUsers%7Busers%7Bid%7D%7D&variables=%7B%22accessToken%22%3A%22url-secret%22%7D"
        val interceptor = NetworkInspectorApolloInterceptor(
            NetworkInspectorApolloConfig(captureQuery = true, captureVariables = true)
        )
        val event = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(5_000) {
                InspectorEventBus.events.first {
                    it.request.url == "https://example.test/graphql" && it.response != null
                }
            }
        }

        interceptor.intercept(
            HttpRequest.Builder(HttpMethod.Get, url).build(),
            object : HttpInterceptorChain {
                override suspend fun proceed(request: HttpRequest): HttpResponse =
                    HttpResponse.Builder(200).build()
            },
        )

        val captured = event.await()
        val requestPayload = assertNotNull(captured.request.body).content.orEmpty()
        assertEquals("GetUsers", captured.request.operationName)
        assertEquals("query", captured.request.operationType)
        assertTrue(requestPayload.contains("GetUsers"))
        assertTrue(requestPayload.contains("query"))
        assertTrue(requestPayload.contains("<redacted>"))
        assertFalse(requestPayload.contains("url-secret"))
        assertFalse(captured.request.url.contains("variables"))
    }

    @Test
    fun reportsHttpFailuresAndRethrowsTransportExceptions() = runBlocking {
        val url = "https://example.test/graphql"
        val interceptor = NetworkInspectorApolloInterceptor()
        val httpFailure = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(5_000) {
                InspectorEventBus.events.first {
                    it.request.url == url && it.response?.statusCode == 401
                }
            }
        }
        interceptor.intercept(
            HttpRequest.Builder(HttpMethod.Post, url).build(),
            object : HttpInterceptorChain {
                override suspend fun proceed(request: HttpRequest): HttpResponse =
                    HttpResponse.Builder(401).build()
            },
        )
        assertEquals("HttpStatus", httpFailure.await().error?.errorType)

        val transportFailure = IllegalStateException("sensitive details must not be included")
        val networkError = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(5_000) {
                InspectorEventBus.events.first {
                    it.request.url == url && it.response == null && it.error != null
                }
            }
        }
        val thrown = assertFailsWith<IllegalStateException> {
            interceptor.intercept(
                HttpRequest.Builder(HttpMethod.Post, url).build(),
                object : HttpInterceptorChain {
                    override suspend fun proceed(request: HttpRequest): HttpResponse = throw transportFailure
                },
            )
        }

        assertSame(transportFailure, thrown)
        val reported = networkError.await()
        assertEquals("GraphQL HTTP request failed", reported.error?.message)
        assertFalse(reported.error?.message.orEmpty().contains("sensitive details"))
    }
}
