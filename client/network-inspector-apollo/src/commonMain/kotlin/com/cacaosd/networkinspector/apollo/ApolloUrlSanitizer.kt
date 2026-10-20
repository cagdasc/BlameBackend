package com.cacaosd.networkinspector.apollo

internal object ApolloUrlSanitizer {
    fun sanitize(url: String): String {
        val schemeEnd = url.indexOf("://")
        if (schemeEnd < 0) return url.substringBefore('?').substringBefore('#')
        val authorityStart = schemeEnd + 3
        val authorityEnd = url.indexOfAny(charArrayOf('/', '?', '#'), authorityStart)
            .takeIf { it >= 0 } ?: url.length
        val authority = url.substring(authorityStart, authorityEnd).substringAfterLast('@')
        val path = url.substring(authorityEnd).substringBefore('?').substringBefore('#')
        return url.substring(0, authorityStart) + authority + path
    }
}
