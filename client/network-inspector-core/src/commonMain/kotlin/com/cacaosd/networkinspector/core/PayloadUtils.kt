package com.cacaosd.networkinspector.core

import com.cacaosd.networkinspector.protocol.PayloadDto

object PayloadUtils {

    private val BINARY_MEDIA_TYPES = listOf(
        "image/",
        "audio/",
        "video/",
        "font/",
        "application/octet-stream",
        "application/pdf",
        "application/zip",
        "application/gzip"
    )

    fun isBinary(contentType: String?): Boolean {
        if (contentType == null) return false
        val clean = contentType.substringBefore(";").trim().lowercase()
        return BINARY_MEDIA_TYPES.any { clean.startsWith(it) }
    }

    fun createPayload(
        bytes: ByteArray,
        contentType: String?,
        maxSizeBytes: Long,
    ): PayloadDto {
        val sizeBytes = bytes.size.toLong()
        val isBinaryContent = isBinary(contentType)
        val truncated = sizeBytes > maxSizeBytes

        val captureLength =
            if (truncated) maxSizeBytes.coerceAtLeast(0).coerceAtMost(Int.MAX_VALUE.toLong()).toInt() else bytes.size

        return if (isBinaryContent) {
            val previewBytes = bytes.copyOfRange(0, minOf(bytes.size, 64))
            PayloadDto(
                contentType = contentType,
                sizeBytes = sizeBytes,
                content = null,
                truncated = truncated,
                isBinary = true,
                hexPreview = formatHexPreview(previewBytes)
            )
        } else {
            val decodedString = bytes.decodeToString(endIndex = captureLength)

            PayloadDto(
                contentType = contentType,
                sizeBytes = sizeBytes,
                content = decodedString,
                truncated = truncated,
                isBinary = false
            )
        }
    }

    private fun formatHexPreview(bytes: ByteArray): String {
        val hexDigits = "0123456789ABCDEF"
        return bytes.joinToString(" ") { byte ->
            val value = byte.toInt() and 0xFF
            "${hexDigits[value shr 4]}${hexDigits[value and 0x0F]}"
        }
    }
}
