package com.cacaosd.networkinspector.apollo

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ApolloGraphQlPayloadCaptureTest {
    @Test
    fun requestCaptureDefaultsToOperationNameAndDropsSensitiveInlineQuery() {
        val payload = ApolloGraphQlPayloadCapture.requestBody(
            bytes = """{"operationName":"Login","query":"mutation { login(password: \"not-captured\") }","variables":{"password":"also-secret"}}"""
                .encodeToByteArray(),
            size = 128,
            contentType = "application/json",
            config = NetworkInspectorApolloConfig(captureQuery = true, captureVariables = true),
        )

        val text = assertNotNull(payload).content.orEmpty()
        assertTrue(text.contains("Login"))
        assertTrue(text.contains("query omitted"))
        assertFalse(text.contains("not-captured"))
        assertFalse(text.contains("also-secret"))
    }

    @Test
    fun requestCaptureRedactsNestedSecretsAndHonorsOptIns() {
        val payload = ApolloGraphQlPayloadCapture.requestBody(
            bytes = """{"operationName":"Profile","query":"query { profile { name } }","variables":{"id":"42","nested":{"refreshToken":"token-value"}}}"""
                .encodeToByteArray(),
            size = 128,
            contentType = "application/json",
            config = NetworkInspectorApolloConfig(captureVariables = true),
        )

        val text = assertNotNull(payload).content.orEmpty()
        assertTrue(text.contains("Profile"))
        assertTrue(text.contains("42"))
        assertTrue(text.contains("<redacted>"))
        assertFalse(text.contains("query {"))
        assertFalse(text.contains("token-value"))
    }

    @Test
    fun getRequestDecodesEncodedFieldsAndIgnoresInvalidPercentEncoding() {
        val payload = ApolloGraphQlPayloadCapture.getRequest(
            "https://example.test/graphql?operationName=Get+Profile&query=query%20Profile%7Bme%7Bid%7D%7D&variables=%7B%22password%22%3A%22hidden%22%7D&bad=%Q0",
            NetworkInspectorApolloConfig(captureQuery = true, captureVariables = true),
        )

        val text = assertNotNull(payload).content.orEmpty()
        assertTrue(text.contains("Get Profile"))
        assertTrue(text.contains("query Profile"))
        assertTrue(text.contains("<redacted>"))
        assertFalse(text.contains("hidden"))
    }

    @Test
    fun oversizedAndInvalidBodiesAreBoundedOrIgnored() {
        val oversized = ApolloGraphQlPayloadCapture.requestBody(
            bytes = ByteArray(65 * 1024),
            size = 65 * 1024L,
            contentType = "application/json",
            config = NetworkInspectorApolloConfig(captureQuery = true),
        )
        assertTrue(assertNotNull(oversized).truncated)
        assertNull(
            ApolloGraphQlPayloadCapture.requestBody(
                bytes = "not-json".encodeToByteArray(),
                size = 8,
                contentType = "application/json",
                config = NetworkInspectorApolloConfig(),
            )
        )
        assertNull(
            ApolloGraphQlPayloadCapture.getRequest(
                "https://example.test/graphql",
                NetworkInspectorApolloConfig()
            )
        )
    }

    @Test
    fun responseCaptureRedactsSecretFieldsAndSkipsNonJsonBody() {
        val payload = ApolloGraphQlPayloadCapture.responseBody(
            bytes = """{"data":{"user":{"name":"Ada","apiKey":"private"}}}""".encodeToByteArray(),
            size = 52,
            contentType = "application/json",
            config = NetworkInspectorApolloConfig(),
        )
        assertTrue(assertNotNull(payload.content).contains("Ada"))
        assertTrue(payload.content!!.contains("<redacted>"))
        assertFalse(payload.content!!.contains("private"))

        val textPayload = ApolloGraphQlPayloadCapture.responseBody(
            bytes = "plain text".encodeToByteArray(),
            size = 10,
            contentType = "text/plain",
            config = NetworkInspectorApolloConfig(),
        )
        assertEquals(null, textPayload.content)
    }
}
