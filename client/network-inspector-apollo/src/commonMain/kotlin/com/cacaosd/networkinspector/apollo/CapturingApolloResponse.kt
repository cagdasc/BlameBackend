package com.cacaosd.networkinspector.apollo

import com.apollographql.apollo.api.http.HttpResponse
import com.cacaosd.networkinspector.protocol.PayloadDto
import okio.Buffer
import okio.ForwardingSource
import okio.buffer

internal object CapturingApolloResponse {
    private const val READ_CHUNK_SIZE = 8 * 1024L

    fun wrap(
        response: HttpResponse,
        config: NetworkInspectorApolloConfig,
        onComplete: (PayloadDto, Long) -> Unit,
    ): HttpResponse {
        val source = response.body ?: return response
        var finalized = false
        var reachedEof = false
        var responseSize = 0L
        val captured = Buffer()

        fun finishCapture() {
            if (finalized) return
            finalized = true
            val totalSize = response.headers.contentLength().takeIf { it >= 0 } ?: responseSize
            val payload = if (reachedEof) {
                ApolloGraphQlPayloadCapture.responseBody(
                    captured.readByteArray(),
                    totalSize,
                    response.headers.contentType(),
                    config,
                )
            } else {
                PayloadDto(
                    contentType = response.headers.contentType(),
                    sizeBytes = totalSize,
                    content = null,
                    truncated = true,
                    isBinary = false,
                )
            }
            onComplete(payload, totalSize)
        }

        val tappedSource = object : ForwardingSource(source) {
            override fun read(sink: Buffer, byteCount: Long): Long {
                val chunk = Buffer()
                val read = super.read(chunk, minOf(byteCount, READ_CHUNK_SIZE))
                if (read > 0) {
                    responseSize += read
                    val remaining = config.captureLimit + 1 - captured.size
                    if (remaining > 0) chunk.copyTo(captured, byteCount = minOf(read, remaining))
                    sink.write(chunk, read)
                } else if (read == -1L) {
                    reachedEof = true
                    finishCapture()
                }
                return read
            }

            override fun close() {
                try {
                    super.close()
                } finally {
                    finishCapture()
                }
            }
        }.buffer()

        return HttpResponse.Builder(response.statusCode)
            .headers(response.headers)
            .body(tappedSource)
            .addExecutionContext(response.executionContext)
            .build()
    }
}
