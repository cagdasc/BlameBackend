package com.cacaosd.blamebackend

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import io.ktor.client.HttpClient
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
fun RestExamples(
    client: HttpClient,
    onRequest: SampleRequestHandler,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ExampleSection(
            title = "Read data",
            description = "GET requests and query parameters",
        ) {
            ExampleButton("Load posts") {
                onRequest("Load posts") {
                    "Loaded ${client.get("$BASE_URL/posts").body<List<Post>>().size} posts"
                }
            }
            ExampleButton("Load posts for user 1") {
                onRequest("Load posts for user 1") {
                    val posts = client.get("$BASE_URL/posts") {
                        parameter("userId", 1)
                    }.body<List<Post>>()
                    "Loaded ${posts.size} posts for user 1"
                }
            }
            ExampleButton("Load post 1") {
                onRequest("Load post 1") {
                    val post = client.get("$BASE_URL/posts/1").body<Post>()
                    "Loaded post ${post.id}: ${post.title}"
                }
            }
            ExampleButton("Load comments for post 1") {
                onRequest("Load comments for post 1") {
                    val comments = client.get("$BASE_URL/posts/1/comments").body<List<Comment>>()
                    "Loaded ${comments.size} comments for post 1"
                }
            }
            ExampleButton("Request missing post (expected 404)") {
                onRequest("Request missing post") {
                    client.get("$BASE_URL/posts/101").body<Post>()
                    "Unexpectedly loaded missing post"
                }
            }
        }

        ExampleSection(
            title = "Write data",
            description = "POST, PUT, PATCH, and DELETE requests",
        ) {
            ExampleButton("Create post (POST)") {
                onRequest("Create post") {
                    val post = client.post("$BASE_URL/posts") {
                        contentType(ContentType.Application.Json)
                        setBody(PostRequest(1, "Created by BlameBackend", "A sample post."))
                    }.body<Post>()
                    "Created post ${post.id}: ${post.title}"
                }
            }
            ExampleButton("Replace post 1 (PUT)") {
                onRequest("Replace post 1") {
                    val post = client.put("$BASE_URL/posts/1") {
                        contentType(ContentType.Application.Json)
                        setBody(Post(1, 1, "Replaced by BlameBackend", "A replacement post."))
                    }.body<Post>()
                    "Replaced post ${post.id}: ${post.title}"
                }
            }
            ExampleButton("Patch post 1 (PATCH)") {
                onRequest("Patch post 1") {
                    val post = client.patch("$BASE_URL/posts/1") {
                        contentType(ContentType.Application.Json)
                        setBody(PostPatchRequest("Patched by BlameBackend"))
                    }.body<Post>()
                    "Patched post ${post.id}: ${post.title}"
                }
            }
            ExampleButton("Delete post 1 (DELETE)") {
                onRequest("Delete post 1") {
                    "Deleted post 1: ${client.delete("$BASE_URL/posts/1").bodyAsText()}"
                }
            }
        }

        ExampleSection(
            title = "Traffic load",
            description = "Send a batch of varied REST requests",
        ) {
            ExampleButton("Run 10 random requests sequentially") {
                onRequest("Run 10 random requests sequentially") {
                    buildList {
                        repeat(10) { index ->
                            add(runRandomRequest(index + 1, client))
                        }
                    }.joinToString(separator = "\n", prefix = "Sequential run complete:\n")
                }
            }
            ExampleButton("Run 10 random requests concurrently") {
                onRequest("Run 10 random requests concurrently") {
                    coroutineScope {
                        (1..10).map { index ->
                            async { runRandomRequest(index, client) }
                        }.awaitAll()
                    }.joinToString(separator = "\n", prefix = "Concurrent run complete:\n")
                }
            }
        }
    }
}

private suspend fun runRandomRequest(index: Int, client: HttpClient): String = try {
    val id = Random.nextInt(from = 1, until = 101)
    val result = when (Random.nextInt(8)) {
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
        else -> {
            val comments = client.get("$BASE_URL/posts/$id/comments").body<List<Comment>>()
            "GET posts/$id/comments: loaded ${comments.size} comments"
        }
    }
    "$index. $result"
} catch (cancellation: CancellationException) {
    throw cancellation
} catch (exception: Exception) {
    "$index. Request failed: ${exception.message ?: "Unknown error"}"
}
