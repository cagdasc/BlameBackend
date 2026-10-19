package com.cacaosd.blamebackend

import io.ktor.client.HttpClient

expect fun createPlatformHttpClient(): HttpClient
