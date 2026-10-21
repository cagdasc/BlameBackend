package com.cacaosd.blamebackend.linux

import com.apollographql.apollo.ApolloCall
import com.apollographql.apollo.ApolloClient
import com.apollographql.apollo.api.Operation
import com.apollographql.apollo.api.Optional
import com.cacaosd.blamebackend.createPlaceholderApolloClient
import com.cacaosd.blamebackend.placeholder.AlbumPhotosQuery
import com.cacaosd.blamebackend.placeholder.ListPostsQuery
import com.cacaosd.blamebackend.placeholder.ListUsersQuery
import com.cacaosd.blamebackend.placeholder.PostCommentsQuery
import com.cacaosd.blamebackend.placeholder.UserPostsQuery
import com.cacaosd.networkinspector.protocol.HelloPayload
import com.cacaosd.networkinspector.transport.NetworkInspector
import kotlinx.coroutines.runBlocking

fun apolloMain() = runBlocking {
    NetworkInspector.install(
        HelloPayload(
            deviceName = "Linux",
            osVersion = "Kotlin/Native linuxX64",
            appName = "BlameBackend-Linux-Apollo",
            appVersion = "0.0.1",
        )
    )

    val client = createPlaceholderApolloClient()

    try {
        runGraphQlExamples(client)
    } finally {
        client.close()
        NetworkInspector.stop()
    }
}

private suspend fun runGraphQlExamples(client: ApolloClient) {
    println("GraphQLPlaceholder via Apollo:")

    val users = client.query(ListUsersQuery()).executeData().users.orEmpty().filterNotNull()
    println("Users: ${users.take(3).joinToString { user -> user.name ?: "User ${user.id}" }}")

    val posts = client.query(ListPostsQuery()).executeData().posts.orEmpty().filterNotNull()
    println("Posts with nested authors/comments: ${posts.size}")
    posts.take(3).forEach { post ->
        println(
            "  ${post.id}. ${post.title ?: "Untitled"} by ${post.user?.name ?: "Unknown"} " +
                    "(${post.comments.orEmpty().filterNotNull().size} comments)"
        )
    }

    val userPosts = client.query(
        UserPostsQuery(userId = 1, first = Optional.Present(3))
    ).executeData().posts.orEmpty().filterNotNull()
    println("Posts for user 1 via variables: ${userPosts.size}")

    val comments = client.query(
        PostCommentsQuery(postId = 1, first = Optional.Present(3))
    ).executeData().comments.orEmpty().filterNotNull()
    println("Comments for post 1 via variables: ${comments.size}")

    val photos = client.query(AlbumPhotosQuery()).executeData().photos.orEmpty().filterNotNull()
    println("Photos for album 1: ${photos.size}")
}

private suspend fun <D : Operation.Data> ApolloCall<D>.executeData(): D {
    val response = execute()
    response.exception?.let { throw it }
    return response.data ?: error("GraphQL operation returned no data")
}
