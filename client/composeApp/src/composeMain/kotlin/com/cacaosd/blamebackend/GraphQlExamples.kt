package com.cacaosd.blamebackend

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import com.apollographql.apollo.ApolloCall
import com.apollographql.apollo.ApolloClient
import com.apollographql.apollo.api.Operation
import com.apollographql.apollo.api.Optional
import com.cacaosd.blamebackend.placeholder.AlbumPhotosQuery
import com.cacaosd.blamebackend.placeholder.CreatePostMutation
import com.cacaosd.blamebackend.placeholder.DeletePostMutation
import com.cacaosd.blamebackend.placeholder.ListAlbumsQuery
import com.cacaosd.blamebackend.placeholder.ListPostsQuery
import com.cacaosd.blamebackend.placeholder.ListTodosQuery
import com.cacaosd.blamebackend.placeholder.ListUsersQuery
import com.cacaosd.blamebackend.placeholder.PostCommentsQuery
import com.cacaosd.blamebackend.placeholder.UpdatePostMutation
import com.cacaosd.blamebackend.placeholder.UserDetailsQuery
import com.cacaosd.blamebackend.placeholder.UserPostsQuery

@Composable
fun GraphQlExamples(
    client: ApolloClient,
    onRequest: SampleRequestHandler,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ExampleSection(
            title = "Users and profiles",
            description = "Fetch user lists or a profile with nested address and company data",
        ) {
            ExampleButton("List users") {
                onRequest("Load users") {
                    val users = client.query(ListUsersQuery()).executeData().users
                        .orEmpty().filterNotNull()
                    users.joinToString(
                        separator = "\n",
                        prefix = "Loaded ${users.size} users:\n",
                    ) { user ->
                        "${user.id}. ${user.name ?: user.username ?: "Unnamed"} (${user.email ?: "no email"})"
                    }
                }
            }
            ExampleButton("Load user profile (user 1)") {
                onRequest("Load user profile") {
                    val user = client.query(UserDetailsQuery()).executeData().userById
                        ?: error("User not found")
                    "User ${user.id}: ${user.name ?: "Unnamed"}\n" +
                            "Email: ${user.email ?: "n/a"}\n" +
                            "Location: ${user.address?.city ?: "n/a"}\n" +
                            "Company: ${user.company?.name ?: "n/a"}"
                }
            }
        }

        ExampleSection(
            title = "Posts and comments",
            description = "Explore nested fields and pass GraphQL variables",
        ) {
            ExampleButton("List posts with authors and comments") {
                onRequest("Load posts and nested data") {
                    val posts = client.query(ListPostsQuery()).executeData().posts
                        .orEmpty().filterNotNull()
                    posts.joinToString(
                        separator = "\n",
                        prefix = "Loaded ${posts.size} posts:\n",
                    ) { post ->
                        "${post.id}. ${post.title ?: "Untitled"} — ${post.user?.name ?: "Unknown author"} " +
                                "(${post.comments.orEmpty().filterNotNull().size} comments)"
                    }
                }
            }
            ExampleButton("List posts for user 1 (with variables)") {
                onRequest("Load user posts") {
                    val posts = client.query(
                        UserPostsQuery(userId = 1, first = Optional.Present(5))
                    ).executeData().posts.orEmpty().filterNotNull()
                    posts.joinToString(
                        separator = "\n",
                        prefix = "Loaded ${posts.size} posts for user 1:\n",
                    ) { post -> "${post.id}. ${post.title ?: "Untitled"}" }
                }
            }
            ExampleButton("Load comments for post 1 (with variables)") {
                onRequest("Load comments") {
                    val comments = client.query(
                        PostCommentsQuery(postId = 1, first = Optional.Present(5))
                    ).executeData().comments.orEmpty().filterNotNull()
                    comments.joinToString(
                        separator = "\n",
                        prefix = "Loaded ${comments.size} comments:\n",
                    ) { comment ->
                        "${comment.name ?: "Comment ${comment.id}"}: ${comment.body ?: ""}"
                    }
                }
            }
        }

        ExampleSection(
            title = "Albums, photos, and todos",
            description = "Query other resource types and nested relationships",
        ) {
            ExampleButton("List albums with photos") {
                onRequest("Load albums and photos") {
                    val albums = client.query(ListAlbumsQuery()).executeData().albums
                        .orEmpty().filterNotNull()
                    albums.joinToString(
                        separator = "\n",
                        prefix = "Loaded ${albums.size} albums:\n",
                    ) { album ->
                        "${album.id}. ${album.title ?: "Untitled"} — ${album.user?.name ?: "Unknown user"} " +
                                "(${album.photos.orEmpty().filterNotNull().size} sample photos)"
                    }
                }
            }
            ExampleButton("Load photos for album 1") {
                onRequest("Load album photos") {
                    val photos = client.query(AlbumPhotosQuery()).executeData().photos
                        .orEmpty().filterNotNull()
                    photos.joinToString(
                        separator = "\n",
                        prefix = "Loaded ${photos.size} photos:\n",
                    ) { photo ->
                        "${photo.id}. ${photo.title ?: "Untitled"} — ${photo.thumbnailUrl ?: "no thumbnail"}"
                    }
                }
            }
            ExampleButton("List todos for user 1") {
                onRequest("Load todos") {
                    val todos = client.query(ListTodosQuery()).executeData().todos
                        .orEmpty().filterNotNull()
                    todos.joinToString(
                        separator = "\n",
                        prefix = "Loaded ${todos.size} todos:\n",
                    ) { todo ->
                        "${if (todo.completed == true) "[x]" else "[ ]"} ${todo.title ?: "Todo ${todo.id}"}"
                    }
                }
            }
        }

        ExampleSection(
            title = "Post mutations",
            description = "Create, update, and delete posts with GraphQL mutations",
        ) {
            ExampleButton("Create a post") {
                onRequest("Create post") {
                    val post = client.mutation(CreatePostMutation()).executeData().createPost
                        ?: error("Create post returned no post")
                    "Created post ${post.id}: ${post.title ?: "Untitled"}"
                }
            }
            ExampleButton("Update post 1") {
                onRequest("Update post") {
                    val post = client.mutation(UpdatePostMutation()).executeData().updatePost
                        ?: error("Update post returned no post")
                    "Updated post ${post.id}: ${post.title ?: "Untitled"}"
                }
            }
            ExampleButton("Delete post 1") {
                onRequest("Delete post") {
                    val result = client.mutation(DeletePostMutation()).executeData().deletePost
                    "Delete post result: ${result ?: "no message"}"
                }
            }
        }
    }
}

private suspend fun <D : Operation.Data> ApolloCall<D>.executeData(): D {
    val response = execute()
    response.exception?.let { throw it }
    return response.data ?: error("GraphQL operation returned no data")
}
