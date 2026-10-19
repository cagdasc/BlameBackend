package com.cacaosd.networkinspector.core

import io.github.oshai.kotlinlogging.KotlinLogging

private val logger = KotlinLogging.logger {}

internal actual fun logInspectorError(message: String, error: Throwable) {
    logger.error(error) { message }
}
