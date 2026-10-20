package com.cacaosd.networkinspector.apollo

data class NetworkInspectorApolloConfig(
    val captureQuery: Boolean = false,
    val captureVariables: Boolean = false,
    val captureResponseBody: Boolean = false,
    val maxBodySizeBytes: Long = DEFAULT_MAX_BODY_SIZE_BYTES,
) {
    init {
        require(maxBodySizeBytes >= 0) { "maxBodySizeBytes must not be negative" }
    }

    internal val captureLimit: Long
        get() = maxBodySizeBytes.coerceAtMost(MAX_CAPTURE_BYTES)
}

internal const val DEFAULT_MAX_BODY_SIZE_BYTES = 64 * 1024L
internal const val MAX_CAPTURE_BYTES = 64 * 1024L
