package com.cacaosd.blamebackend

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlin.random.Random

private const val BASE_URL = "https://jsonplaceholder.typicode.com"

@Serializable
private data class Post(
    val userId: Int,
    val id: Int,
    val title: String,
    val body: String,
)

@Serializable
private data class PostRequest(
    val userId: Int,
    val title: String,
    val body: String,
)

@Serializable
private data class PostPatchRequest(val title: String)

@Serializable
private data class Comment(
    val postId: Int,
    val id: Int,
    val name: String,
    val email: String,
    val body: String,
)

@Composable
fun App() {
    val client = remember { createPlatformHttpClient() }
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf("Ready") }
    DisposableEffect(client) {
        onDispose { client.close() }
    }

    fun request(label: String, action: suspend () -> String) {
        scope.launch {
            status = "$label..."
            try {
                status = action()
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (exception: Exception) {
                status = "$label failed: ${exception.message ?: "Unknown error"}"
            }
        }
    }

    fun createRandomRequest(): suspend () -> String {
        val id = Random.nextInt(from = 1, until = 101)
        return {
            when (Random.nextInt(9)) {
                0 -> "GET posts: loaded ${client.get("$BASE_URL/posts").body<List<Post>>().size} posts"
                1 -> {
                    val posts = client.get("$BASE_URL/posts") {
                        parameter("userId", 1)
                    }.body<List<Post>>()
                    "GET posts?userId=1: loaded ${posts.size} posts"
                }

                2 -> "GET posts/$id: loaded post ${client.get("$BASE_URL/posts/$id").body<Post>().id}"
                3 -> "POST posts: created post ${
                    client.post("$BASE_URL/posts") {
                        contentType(ContentType.Application.Json)
                        setBody(PostRequest(1, "Created by BlameBackend", "A sample post."))
                    }.body<Post>().id
                }"

                4 -> "PUT posts/$id: replaced post ${
                    client.put("$BASE_URL/posts/$id") {
                        contentType(ContentType.Application.Json)
                        setBody(Post(1, id, "Replaced by BlameBackend", "A replacement post."))
                    }.body<Post>().id
                }"

                5 -> "PATCH posts/$id: patched post ${
                    client.patch("$BASE_URL/posts/$id") {
                        contentType(ContentType.Application.Json)
                        setBody(PostPatchRequest("Patched by BlameBackend"))
                    }.body<Post>().id
                }"

                6 -> "DELETE posts/$id: ${client.delete("$BASE_URL/posts/$id").bodyAsText()}"
                7 -> {
                    val comments = client.get("$BASE_URL/posts/$id/comments").body<List<Comment>>()
                    "GET posts/$id/comments: loaded ${comments.size} comments"
                }

                else -> "GET posts/101 (expected 404): ${
                    client.get("$BASE_URL/posts/101").bodyAsText()
                }"
            }
        }
    }

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("BlameBackend")
                Text(status, modifier = Modifier.fillMaxWidth())
                RequestButton("Load posts") {
                    request("Load posts") {
                        "Loaded ${client.get("$BASE_URL/posts").body<List<Post>>().size} posts"
                    }
                }
                RequestButton("Load posts for user 1") {
                    request("Load posts for user 1") {
                        val posts = client.get("$BASE_URL/posts") {
                            parameter("userId", 1)
                        }.body<List<Post>>()
                        "Loaded ${posts.size} posts for user 1"
                    }
                }
                RequestButton("Load post 1") {
                    request("Load post 1") {
                        val post = client.get("$BASE_URL/posts/1").body<Post>()
                        "Loaded post ${post.id}: ${post.title}"
                    }
                }
                RequestButton("Request missing post (expected 404)") {
                    request("Load missing post 101 (expected 404)") {
                        client.get("$BASE_URL/posts/101").body<Post>()
                        "Unexpectedly loaded missing post"
                    }
                }
                RequestButton("Create post (POST)") {
                    request("Create post") {
                        val post = client.post("$BASE_URL/posts") {
                            contentType(ContentType.Application.Json)
                            setBody(PostRequest(1, "Created by BlameBackend", "A sample post."))
                        }.body<Post>()
                        "Created post ${post.id}"
                    }
                }
                RequestButton("Replace post 1 (PUT)") {
                    request("Replace post 1") {
                        val post = client.put("$BASE_URL/posts/1") {
                            contentType(ContentType.Application.Json)
                            setBody(Post(1, 1, "Replaced by BlameBackend", "A replacement post."))
                        }.body<Post>()
                        "Replaced post ${post.id}"
                    }
                }
                RequestButton("Patch post 1 (PATCH)") {
                    request("Patch post 1") {
                        val post = client.patch("$BASE_URL/posts/1") {
                            contentType(ContentType.Application.Json)
                            setBody(PostPatchRequest("Patched by BlameBackend"))
                        }.body<Post>()
                        "Patched post ${post.id}"
                    }
                }
                RequestButton("Delete post 1 (DELETE)") {
                    request("Delete post 1") {
                        "Deleted post 1: ${client.delete("$BASE_URL/posts/1").bodyAsText()}"
                    }
                }
                RequestButton("Load comments for post 1") {
                    request("Load comments for post 1") {
                        val comments = client.get("$BASE_URL/posts/1/comments").body<List<Comment>>()
                        "Loaded ${comments.size} comments for post 1"
                    }
                }
                RequestButton("Run 10 random requests sequentially") {
                    request("Run 10 random requests sequentially") {
                        val results = buildList {
                            repeat(10) { index ->
                                add(runRandomRequest(index + 1, ::createRandomRequest))
                                status = "Completed ${index + 1}/10 requests sequentially"
                            }
                        }
                        results.joinToString(separator = "\n", prefix = "Sequential run complete:\n")
                    }
                }
                RequestButton("Run 10 random requests concurrently") {
                    request("Run 10 random requests concurrently") {
                        val results = coroutineScope {
                            (1..10).map { index ->
                                async { runRandomRequest(index, ::createRandomRequest) }
                            }.awaitAll()
                        }
                        results.joinToString(separator = "\n", prefix = "Concurrent run complete:\n")
                    }
                }
            }
        }
    }
}

@Composable
private fun RequestButton(label: String, onClick: () -> Unit) {
    Button(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Text(label)
    }
}

private suspend fun runRandomRequest(
    index: Int,
    createAction: () -> (suspend () -> String),
): String = try {
    "$index. ${createAction().invoke()}"
} catch (cancellation: CancellationException) {
    throw cancellation
} catch (exception: Exception) {
    "$index. Request failed: ${exception.message ?: "Unknown error"}"
}
