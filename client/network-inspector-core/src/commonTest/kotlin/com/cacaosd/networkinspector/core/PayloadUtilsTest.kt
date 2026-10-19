package com.cacaosd.networkinspector.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PayloadUtilsTest {
    @Test
    fun capturesTextAndTruncatesAtConfiguredLimit() {
        val payload = PayloadUtils.createPayload(
            bytes = "hello world".encodeToByteArray(),
            contentType = "text/plain; charset=utf-8",
            maxSizeBytes = 5,
        )

        assertEquals("text/plain; charset=utf-8", payload.contentType)
        assertEquals(11L, payload.sizeBytes)
        assertEquals("hello", payload.content)
        assertTrue(payload.truncated)
        assertFalse(payload.isBinary)
        assertNull(payload.hexPreview)
    }

    @Test
    fun createsHexPreviewForBinaryPayload() {
        val payload = PayloadUtils.createPayload(
            bytes = byteArrayOf(0x00, 0x0f, 0x10, 0xff.toByte()),
            contentType = "Application/Octet-Stream; charset=binary",
            maxSizeBytes = 16,
        )

        assertEquals(4L, payload.sizeBytes)
        assertNull(payload.content)
        assertFalse(payload.truncated)
        assertTrue(payload.isBinary)
        assertEquals("00 0F 10 FF", payload.hexPreview)
    }

    @Test
    fun recognizesBinaryMimeTypesIgnoringCaseAndParameters() {
        assertTrue(PayloadUtils.isBinary(" IMAGE/PNG ; name=image.png"))
        assertTrue(PayloadUtils.isBinary("application/pdf"))
        assertFalse(PayloadUtils.isBinary("application/json"))
        assertFalse(PayloadUtils.isBinary(null))
    }
}
