package com.cacaosd.blamebackend.linux

import com.cacaosd.networkinspector.ktor.NetworkInspectorPlugin
import com.cacaosd.networkinspector.protocol.HelloPayload
import com.cacaosd.networkinspector.transport.NetworkInspector
import io.ktor.client.HttpClient
import io.ktor.client.engine.curl.Curl
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking

fun main() = runBlocking {
    NetworkInspector.install(
        HelloPayload(
            deviceName = "Linux",
            osVersion = "Kotlin/Native linuxX64",
            appName = "BlameBackend-LinuxNative",
            appVersion = "0.0.1",
        )
    )

    val client = HttpClient(Curl) {
        install(NetworkInspectorPlugin)
    }

    try {
        coroutineScope {
            val getRequest = async {
                val response = client.get("https://jsonplaceholder.typicode.com/posts/2")
                println("GET /posts/1: ${response.status} ${response.bodyAsText()}")
            }
            val postRequest = async {
                val response = client.post("https://jsonplaceholder.typicode.com/posts") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"title":"Linux Native sample","body":"Captured by network-inspector","userId":1}""")
                }
                println("POST /posts: ${response.status} ${response.bodyAsText()}")
            }

            getRequest.await()
            postRequest.await()
        }
    } finally {
        client.close()
        NetworkInspector.stop()
    }
}
