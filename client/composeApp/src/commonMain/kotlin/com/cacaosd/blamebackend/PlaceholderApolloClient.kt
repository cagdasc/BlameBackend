package com.cacaosd.blamebackend

import com.apollographql.apollo.ApolloClient
import com.cacaosd.networkinspector.apollo.NetworkInspectorApolloConfig
import com.cacaosd.networkinspector.apollo.NetworkInspectorApolloInterceptor

private const val PLACEHOLDER_GRAPHQL_URL = "https://graphqlplaceholder.vercel.app/graphql"

fun createPlaceholderApolloClient(): ApolloClient =
    ApolloClient.Builder()
        .serverUrl(PLACEHOLDER_GRAPHQL_URL)
        .addHttpInterceptor(
            NetworkInspectorApolloInterceptor(
                NetworkInspectorApolloConfig(
                    captureQuery = true,
                    captureVariables = true,
                    captureResponseBody = true,
                )
            )
        )
        .build()
