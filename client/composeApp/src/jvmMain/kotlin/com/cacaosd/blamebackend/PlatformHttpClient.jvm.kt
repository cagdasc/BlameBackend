package com.cacaosd.blamebackend

import com.cacaosd.networkinspector.ktor.NetworkInspectorPlugin
import com.cacaosd.networkinspector.okhttp.NetworkInspectorInterceptor
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

actual fun createPlatformHttpClient(): HttpClient = HttpClient(OkHttp) {
    expectSuccess = true
    install(ContentNegotiation) {
        json(Json {
            ignoreUnknownKeys = true
            coerceInputValues = true
        })
    }
    engine {
        addInterceptor(NetworkInspectorInterceptor())
    }
    install(NetworkInspectorPlugin)
}
