package com.cacaosd.networkinspector.apollo

import com.apollographql.apollo.api.http.HttpBody
import okio.Buffer
import okio.BufferedSink
import okio.Sink
import okio.Timeout
import okio.buffer

internal class CapturingApolloHttpBody(
    private val delegate: HttpBody,
    private val captureLimit: Long,
    private val onComplete: (ByteArray, Long) -> Unit,
) : HttpBody {
    override val contentType: String
        get() = delegate.contentType

    override val contentLength: Long
        get() = delegate.contentLength

    override fun writeTo(bufferedSink: BufferedSink) {
        val captured = Buffer()
        var totalSize = 0L
        val copyLimit = captureLimit + 1
        val teeSink = object : Sink {
            override fun write(source: Buffer, byteCount: Long) {
                totalSize += byteCount
                val remaining = copyLimit - captured.size
                if (remaining > 0) source.copyTo(captured, byteCount = minOf(byteCount, remaining))
                bufferedSink.write(source, byteCount)
            }

            override fun flush() = bufferedSink.flush()

            override fun timeout(): Timeout = bufferedSink.timeout()

            override fun close() = Unit
        }.buffer()
        delegate.writeTo(teeSink)
        teeSink.flush()
        onComplete(captured.readByteArray(), totalSize)
    }
}
