package com.cacaosd.blamebackend

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private enum class SampleTab(val title: String, val description: String) {
    REST("REST · Ktor", "HTTP examples powered by the Ktor client"),
    GRAPHQL("GraphQL · Apollo", "Queries and mutations powered by Apollo Kotlin"),
}

private data class RequestState(
    val label: String = "Ready",
    val output: String = "Choose an example to send a request.",
    val isLoading: Boolean = false,
    val isError: Boolean = false,
)

@Composable
fun App() {
    val httpClient = remember { createPlatformHttpClient() }
    val apolloClient = remember { createPlaceholderApolloClient() }
    val scope = rememberCoroutineScope()
    var selectedTab by remember { mutableStateOf(SampleTab.REST) }
    var requestState by remember { mutableStateOf(RequestState()) }

    DisposableEffect(httpClient) {
        onDispose { httpClient.close() }
    }
    DisposableEffect(apolloClient) {
        onDispose { apolloClient.close() }
    }

    val onRequest: (String, suspend () -> String) -> Unit = { label, action ->
        scope.launch {
            requestState = RequestState(label = label, output = "Request in progress…", isLoading = true)
            try {
                requestState = RequestState(label = label, output = action())
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (exception: Exception) {
                requestState = RequestState(
                    label = label,
                    output = exception.message ?: "Unknown error",
                    isError = true,
                )
            }
        }
    }

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("BlameBackend", style = MaterialTheme.typography.headlineMedium)
                    Text(
                        "Try the sample clients and inspect their traffic in the network inspector.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                PrimaryTabRow(selectedTabIndex = selectedTab.ordinal) {
                    SampleTab.entries.forEach { tab ->
                        Tab(
                            selected = selectedTab == tab,
                            onClick = { selectedTab = tab },
                            text = { Text(tab.title) },
                        )
                    }
                }

                Text(
                    selectedTab.description,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    when (selectedTab) {
                        SampleTab.REST -> RestExamples(httpClient, onRequest)
                        SampleTab.GRAPHQL -> GraphQlExamples(apolloClient, onRequest)
                    }
                }

                RequestResultCard(requestState)
            }
        }
    }
}

@Composable
private fun RequestResultCard(state: RequestState) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    state.label,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleSmall,
                )
                if (state.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.heightIn(max = 22.dp),
                        strokeWidth = 2.dp,
                    )
                }
            }
            Text(
                state.output,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 120.dp)
                    .verticalScroll(rememberScrollState()),
                style = MaterialTheme.typography.bodyMedium,
                color = if (state.isError) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
        }
    }
}
