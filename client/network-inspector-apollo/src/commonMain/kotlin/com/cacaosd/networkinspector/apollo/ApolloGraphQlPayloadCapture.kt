package com.cacaosd.networkinspector.apollo

import com.apollographql.apollo.api.http.HttpHeader
import com.cacaosd.networkinspector.core.HeaderRedactor
import com.cacaosd.networkinspector.core.InspectorEventBus
import com.cacaosd.networkinspector.core.PayloadUtils
import com.cacaosd.networkinspector.protocol.PayloadDto
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull

data class GraphQlOperationMetadata(
    val operationName: String? = null,
    val operationType: String? = null,
)

internal object ApolloGraphQlPayloadCapture {
    fun extractOperationMetadata(bytes: ByteArray): GraphQlOperationMetadata {
        val body = try {
            Json.parseToJsonElement(bytes.decodeToString()) as? JsonObject
        } catch (_: Exception) {
            null
        } ?: return GraphQlOperationMetadata()

        val operationName = (body["operationName"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
        val query = (body["query"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
        val operationType = detectOperationType(query)
        return GraphQlOperationMetadata(operationName, operationType)
    }

    fun extractOperationMetadataFromUrl(url: String): GraphQlOperationMetadata {
        val encodedQuery = url.substringAfter('?', "").substringBefore('#')
        if (encodedQuery.isEmpty()) return GraphQlOperationMetadata()
        var opName: String? = null
        var queryStr: String? = null
        for (part in encodedQuery.split('&')) {
            val separator = part.indexOf('=')
            if (separator < 0) continue
            val name = part.substring(0, separator).decodeQueryComponent() ?: continue
            val value = part.substring(separator + 1).decodeQueryComponent() ?: continue
            if (name == "operationName") opName = value
            if (name == "query") queryStr = value
        }
        return GraphQlOperationMetadata(opName, detectOperationType(queryStr))
    }

    fun detectOperationType(query: String?): String? {
        if (query.isNullOrBlank()) return null
        val trimmed = query.trimStart()
        return when {
            trimmed.startsWith("mutation", ignoreCase = true) -> "mutation"
            trimmed.startsWith("subscription", ignoreCase = true) -> "subscription"
            trimmed.startsWith("query", ignoreCase = true) -> "query"
            trimmed.startsWith("{") -> "query"
            else -> null
        }
    }
    fun requestBody(
        bytes: ByteArray,
        size: Long,
        contentType: String,
        config: NetworkInspectorApolloConfig,
    ): PayloadDto? {
        if (size > config.captureLimit) {
            return truncatedPayload(contentType, size)
        }
        val body = try {
            Json.parseToJsonElement(bytes.decodeToString()) as? JsonObject
        } catch (_: SerializationException) {
            null
        } ?: return null

        val fields = buildJsonObject {
            body["operationName"]?.let { put("operationName", it) }
            if (config.captureQuery) {
                (body["query"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.let { query ->
                    put(
                        "query",
                        if (query.hasSensitiveLiteralArgument()) {
                            JsonPrimitive("[query omitted: sensitive argument]")
                        } else {
                            JsonPrimitive(query)
                        },
                    )
                }
            }
            if (config.captureVariables) {
                (body["variables"] as? JsonObject)?.let { put("variables", it.redactSensitiveValues()) }
            }
        }
        if (fields.isEmpty()) return null

        val payload = PayloadUtils.createPayload(
            bytes = fields.toString().encodeToByteArray(),
            contentType = contentType,
            maxSizeBytes = config.captureLimit,
        )
        return payload.copy(sizeBytes = size, truncated = payload.truncated || size > config.captureLimit)
    }

    fun getRequest(url: String, config: NetworkInspectorApolloConfig): PayloadDto? {
        val encodedQuery = url.substringAfter('?', "").substringBefore('#')
        if (encodedQuery.isEmpty()) return null
        val queryBytes = encodedQuery.encodeToByteArray()
        if (queryBytes.size > config.captureLimit) {
            return truncatedPayload("application/json", queryBytes.size.toLong())
        }

        val parameters = mutableMapOf<String, String>()
        for (part in encodedQuery.split('&')) {
            val separator = part.indexOf('=')
            if (separator < 0) continue
            val name = part.substring(0, separator).decodeQueryComponent() ?: continue
            if (name !in GRAPHQL_GET_PARAMETERS || name in parameters) continue
            parameters[name] = part.substring(separator + 1).decodeQueryComponent() ?: continue
        }

        val body = buildJsonObject {
            parameters["operationName"]?.let { put("operationName", JsonPrimitive(it)) }
            parameters["query"]?.let { put("query", JsonPrimitive(it)) }
            parameters["variables"]?.let { raw ->
                val variables = try {
                    Json.parseToJsonElement(raw)
                } catch (_: SerializationException) {
                    null
                }
                if (variables != null) put("variables", variables)
            }
        }
        return requestBody(body.toString().encodeToByteArray(), queryBytes.size.toLong(), "application/json", config)
    }

    fun responseBody(
        bytes: ByteArray,
        size: Long,
        contentType: String?,
        config: NetworkInspectorApolloConfig,
    ): PayloadDto {
        if (size > config.captureLimit) return truncatedPayload(contentType, size)

        val json = try {
            Json.parseToJsonElement(bytes.decodeToString())
        } catch (_: SerializationException) {
            null
        }
        if (json !is JsonObject && json !is JsonArray) {
            return PayloadDto(contentType, size, null, false, false)
        }

        val payload = PayloadUtils.createPayload(
            bytes = json.redactSensitiveValues().toString().encodeToByteArray(),
            contentType = contentType,
            maxSizeBytes = config.captureLimit,
        )
        return payload.copy(sizeBytes = size, truncated = payload.truncated || size > config.captureLimit)
    }

    private fun truncatedPayload(contentType: String?, size: Long) = PayloadDto(
        contentType = contentType,
        sizeBytes = size,
        content = null,
        truncated = true,
        isBinary = false,
    )

    private fun JsonElement.redactSensitiveValues(): JsonElement = when (this) {
        is JsonObject -> JsonObject(
            mapValues { (name, value) ->
                if (InspectorEventBus.redactor.isSensitive(name)) {
                    JsonPrimitive(HeaderRedactor.REDACTED_VALUE)
                } else {
                    value.redactSensitiveValues()
                }
            }
        )

        is JsonArray -> JsonArray(map { it.redactSensitiveValues() })
        else -> this
    }

    private fun String.hasSensitiveLiteralArgument(): Boolean =
        SENSITIVE_ARGUMENT_REGEX.containsMatchIn(this)

    private fun String.decodeQueryComponent(): String? {
        val decoded = StringBuilder()
        var index = 0
        while (index < length) {
            when (this[index]) {
                '+' -> {
                    decoded.append(' ')
                    index++
                }

                '%' -> {
                    val bytes = okio.Buffer()
                    while (index < length && this[index] == '%') {
                        if (index + 2 >= length) return null
                        val high = this[index + 1].digitToIntOrNull(16) ?: return null
                        val low = this[index + 2].digitToIntOrNull(16) ?: return null
                        bytes.writeByte((high shl 4) or low)
                        index += 3
                    }
                    decoded.append(bytes.readUtf8())
                }

                else -> decoded.append(this[index++])
            }
        }
        return decoded.toString()
    }

    private val GRAPHQL_GET_PARAMETERS = setOf("operationName", "query", "variables")
    private val SENSITIVE_ARGUMENT_REGEX = Regex(
        """\b[\w-]*(?:authorization|cookie|password|passwd|secret|credential|token|api[_-]?key|pass(?:word|wd|code)|pwd)[\w-]*\s*:""",
        RegexOption.IGNORE_CASE,
    )
}

internal fun List<HttpHeader>.toHeaderMap(): Map<String, String> =
    groupBy(HttpHeader::name).mapValues { (_, headers) -> headers.joinToString(", ") { it.value } }

internal fun List<HttpHeader>.contentType(): String? =
    firstOrNull { it.name.equals("Content-Type", ignoreCase = true) }?.value

internal fun List<HttpHeader>.contentLength(): Long =
    firstNotNullOfOrNull { header ->
        if (header.name.equals("Content-Length", ignoreCase = true)) header.value.toLongOrNull() else null
    } ?: -1L
