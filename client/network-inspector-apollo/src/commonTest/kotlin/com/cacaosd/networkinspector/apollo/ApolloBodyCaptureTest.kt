package com.cacaosd.networkinspector.apollo

import com.apollographql.apollo.api.http.ByteStringHttpBody
import com.apollographql.apollo.api.http.HttpResponse
import okio.Buffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ApolloBodyCaptureTest {
    @Test
    fun requestBodyTeePreservesBytesAndBoundsCapture() {
        val bodyBytes = "0123456789".encodeToByteArray()
        var capturedBytes = byteArrayOf()
        var capturedSize = 0L
        val body = CapturingApolloHttpBody(
            delegate = ByteStringHttpBody("text/plain", bodyBytes.decodeToString()),
            captureLimit = 4,
        ) { bytes, size ->
            capturedBytes = bytes
            capturedSize = size
        }
        val transmitted = Buffer()

        body.writeTo(transmitted)

        assertEquals("0123456789", transmitted.readUtf8())
        assertEquals("01234", capturedBytes.decodeToString())
        assertEquals(10L, capturedSize)
    }

    @Test
    fun responseWrapperPreservesStreamAndEmitsCaptureOnce() {
        val response = HttpResponse.Builder(200)
            .addHeader("Content-Type", "application/json")
            .body(Buffer().writeUtf8("""{"data":{"name":"Ada"}}"""))
            .build()
        var callbackCount = 0
        var captured: com.cacaosd.networkinspector.protocol.PayloadDto? = null
        val wrapped = CapturingApolloResponse.wrap(
            response,
            NetworkInspectorApolloConfig(captureResponseBody = true)
        ) { payload, _ ->
            callbackCount++
            captured = payload
        }

        assertEquals("""{"data":{"name":"Ada"}}""", wrapped.body!!.readUtf8())
        assertEquals(1, callbackCount)
        assertTrue(assertNotNull(captured).content!!.contains("Ada"))
    }

    @Test
    fun closingPartiallyReadResponseMarksCaptureTruncated() {
        val response = HttpResponse.Builder(200)
            .addHeader("Content-Length", "100")
            .addHeader("Content-Type", "application/json")
            .body(Buffer().writeUtf8("""{"data":"large response"}"""))
            .build()
        var captured: com.cacaosd.networkinspector.protocol.PayloadDto? = null
        val wrapped = CapturingApolloResponse.wrap(
            response,
            NetworkInspectorApolloConfig(captureResponseBody = true)
        ) { payload, _ ->
            captured = payload
        }

        wrapped.body!!.readByteArray(2)
        wrapped.body!!.close()

        val payload = assertNotNull(captured)
        assertTrue(payload.truncated)
        assertEquals(null, payload.content)
    }
}
