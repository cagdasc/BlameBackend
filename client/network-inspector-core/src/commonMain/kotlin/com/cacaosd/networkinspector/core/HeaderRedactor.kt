package com.cacaosd.networkinspector.core

/**
 * Enforces redaction of sensitive credentials, cookies, and API keys.
 * Matches case-insensitively and returns safe header mappings.
 */
class HeaderRedactor(customSensitiveHeaders: List<String> = emptyList()) {

    companion object {
        const val REDACTED_VALUE = "<redacted>"

        val DEFAULT_SENSITIVE_HEADERS = listOf(
            "authorization",
            "proxy-authorization",
            "cookie",
            "set-cookie",
            "x-api-key",
            "x-auth-token",
            "apikey",
            "access-token"
        )
    }

    private val sensitiveSet: Set<String> = (DEFAULT_SENSITIVE_HEADERS + customSensitiveHeaders)
        .map { it.lowercase() }
        .toSet()

    fun isSensitive(headerName: String): Boolean {
        return sensitiveSet.contains(headerName.lowercase())
    }

    fun redact(headers: Map<String, String>): Map<String, String> {
        val result = mutableMapOf<String, String>()
        for ((key, value) in headers) {
            if (isSensitive(key)) {
                result[key] = REDACTED_VALUE
            } else {
                result[key] = value
            }
        }
        return result
    }
}
