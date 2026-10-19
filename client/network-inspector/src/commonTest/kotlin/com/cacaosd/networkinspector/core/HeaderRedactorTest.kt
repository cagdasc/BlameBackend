package com.cacaosd.networkinspector.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HeaderRedactorTest {
    @Test
    fun redactsDefaultAndCustomHeadersWithoutChangingSafeValues() {
        val headers = mapOf(
            "Authorization" to "Bearer secret",
            "X-Internal-Token" to "custom secret",
            "Accept" to "application/json",
        )
        val redactor = HeaderRedactor(listOf("x-internal-token"))

        val redacted = redactor.redact(headers)

        assertEquals("<redacted>", redacted["Authorization"])
        assertEquals("<redacted>", redacted["X-Internal-Token"])
        assertEquals("application/json", redacted["Accept"])
        assertEquals("Bearer secret", headers["Authorization"])
        assertTrue(redactor.isSensitive("AUTHORIZATION"))
        assertFalse(redactor.isSensitive("Accept"))
    }
}
