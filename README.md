# BlameBackend [![](https://jitpack.io/v/cagdasc/BlameBackend.svg)](https://jitpack.io/#cagdasc/BlameBackend)

**Real-time Kotlin Multiplatform Network Inspector & Terminal TUI for Ktor, OkHttp, and Apollo GraphQL.**
BlameBackend captures HTTP/HTTPS traffic directly from your Kotlin Multiplatform apps (Android, iOS, JVM, and Linux) over a local TCP socket, streaming requests, responses, headers, and timings straight into a modern terminal-style web console or headless shell CLI.

⚠️ **Note:** Vibe coded. No idea where it goes.

https://github.com/user-attachments/assets/7ae5331e-1eea-4cbf-94d4-2880ddb94b15

---

## Notice: Client Library Status

> ⚠️ **The Kotlin Multiplatform client library is still actively under development.**  
> The client is split into these artifacts:
> - `network-inspector-core`: shared protocol, capture, and transport; required by the adapters.
> - `network-inspector-ktor`: Ktor plugin for supported multiplatform targets.
> - `network-inspector-okhttp`: OkHttp interceptor for JVM and Android.
> - `network-inspector-apollo`: Apollo Kotlin HTTP interceptor for GraphQL operations.
>
> Add the core module and the adapter(s) your app uses. For JitPack, make sure `https://jitpack.io` is in your dependency repositories:
>
> ```kotlin
> repositories {
>     maven("https://jitpack.io")
> }
>
> commonMain.dependencies {
>     implementation("com.github.cagdasc.BlameBackend:network-inspector-core:<version>")
>     implementation("com.github.cagdasc.BlameBackend:network-inspector-ktor:<version>")
>     implementation("com.github.cagdasc.BlameBackend:network-inspector-apollo:<version>")
> }
> androidMain.dependencies { // or jvmMain
>     implementation("com.github.cagdasc.BlameBackend:network-inspector-okhttp:<version>")
> }
> ```

---

## Features

- **Zero Semantics Alteration**: Intercepts requests and responses non-destructively using OkHttp's `peekBody`.
- **Automatic Port Forwarding**: Automatically detects attached USB devices and emulators, forwarding `tcp:10245` on selection.
- **Interactive TUI Console**: Keyboard-driven UI (`j`/`k` navigation, `/` search, `c` clear, `Tab` panel switching).
- **Headless Terminal CLI**: Stream colored requests directly in your shell (`blamebackend --cli`).
- **Sensitive Data Redaction**: Automatic redaction of auth tokens, cookies, and secret headers.
---

## Installation & Running

<details>
<summary><b>Install from GitHub Releases (.tar.gz with npm)</b></summary>

Download or install the package tarball directly from GitHub Releases using npm:

```bash
# 1. Install globally from GitHub Release tarball:
npm install -g https://github.com/cagdasc/BlameBackend/releases/download/v0.0.1-alpha01/blamebackend-v0.0.1-alpha01.tgz

# (Or install the latest release directly via universal alias)
npm install -g https://github.com/cagdasc/BlameBackend/releases/latest/download/blamebackend.tgz

# 2. Run anywhere:
blamebackend        # Web Console
blamebackend --cli  # Terminal CLI
```

*(Optional: Checksums are provided in `checksums.txt` on the release page to verify tarball integrity with `sha256sum -c checksums.txt`)*
</details>
---

<details>
<summary><b>Run from Source</b></summary>

```bash
# Clone the repository
git clone https://github.com/cagdasc/BlameBackend.git
cd BlameBackend

# Install dependencies
npm install

# Start development server (http://localhost:3000)
npm run dev

# Or run terminal CLI
npm run cli
```
*(In VS Code, you can also press `Ctrl+Shift+B` / `Cmd+Shift+B` to launch the server, or press `F5` to debug).*
</details>

---

## Kotlin Multiplatform (KMP) Setup
The client library supports **Android, iOS, JVM, and Linux** through a shared core with separate Ktor and OkHttp adapter artifacts. Include the core in your common source set, add the Ktor artifact if you use Ktor, and add the OkHttp artifact only to Android/JVM source sets if you use OkHttp.

### 1. Initialize NetworkInspector
Initialize the inspector at application startup to register device info and open the background transport socket (`127.0.0.1:10245`):

<details>
<summary><b>Multiplatform / iOS / Linux</b></summary>

```kotlin
import com.cacaosd.networkinspector.transport.NetworkInspector
import com.cacaosd.networkinspector.transport.NetworkInspectorConfig
import com.cacaosd.networkinspector.protocol.HelloPayload

NetworkInspector.install(
    helloPayload = HelloPayload(
        deviceName = "iOS Simulator",      // or your platform device identifier
        osVersion = "iOS 17.5",
        appName = "com.example.kmpapp",
        appVersion = "1.0.0"
    ),
    configuration = NetworkInspectorConfig(
        port = 10245,                      // Defaults to 10245
        maxBodySizeBytes = 64 * 1024L      // Safe body buffer limit (64 KB)
    )
)
```
</details>

<details>
<summary><b>Android</b></summary>

```kotlin
import android.app.Application
import com.cacaosd.networkinspector.transport.NetworkInspector
import com.cacaosd.networkinspector.transport.install

class BlameBackendApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        NetworkInspector.install(this)
    }
}
```
</details>

<details>
<summary><b>Desktop / JVM</b></summary>

```kotlin
import com.cacaosd.networkinspector.transport.NetworkInspector
import com.cacaosd.networkinspector.transport.install

NetworkInspector.install(
    appName = "MyDesktopApp",
    appVersion = "1.0.0"
)
```
</details>

### 2. Ktor Client Integration
For multiplatform HTTP requests across Android, iOS, and Linux, install the `NetworkInspectorPlugin`:

```kotlin
import io.ktor.client.HttpClient
import com.cacaosd.networkinspector.ktor.NetworkInspectorPlugin

val client = HttpClient {
    install(NetworkInspectorPlugin)
}
```

### 3. OkHttp Interceptor (`Android` & `JVM`)
For Android or JVM apps using OkHttp:

```kotlin
import okhttp3.OkHttpClient
import com.cacaosd.networkinspector.okhttp.NetworkInspectorInterceptor

val client = OkHttpClient.Builder()
    .addInterceptor(NetworkInspectorInterceptor())
    .build()
```


### 4. Apollo GraphQL

Declare Apollo Runtime and the inspector artifacts in the source set, then install the HTTP interceptor:

```kotlin
val apolloClient = ApolloClient.Builder()
    .serverUrl("https://example.com/graphql")
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
```

Query text, variables, and response bodies are off by default. Credential-like headers and fields (including passwords, tokens, and cookies) are redacted even when capture is enabled. Query documents containing inline sensitive arguments are omitted; captured payloads are capped at 64 KB.

### 5. Running Sample Applications

**Android App:**
```bash
cd client
./gradlew :app:installDebug
```
*Tip: Open the **Devices** tab in BlameBackend—attached Android devices and emulators are auto-detected and port-forwarded with `adb reverse tcp:10245 tcp:10245`.*

**Compose Desktop App:**
```bash
cd client
./gradlew :composeApp:run
```
The Compose sample separates **REST · Ktor** and **GraphQL · Apollo** examples into tabs. Try user/profile and nested post/comment queries, albums/photos, todos, and create/update/delete mutations. GraphQL examples include variables as well as inline arguments. Request/response capture is enabled in the sample, while credential redaction remains active.

*Desktop and iOS simulator apps connect directly to `127.0.0.1:10245` without requiring ADB.*

**Linux Native sample:**
```bash
cd client
./gradlew :composeApp:runKtorDebugExecutableLinuxX64
./gradlew :composeApp:runApolloDebugExecutableLinuxX64
```
These are separate Linux Native apps: the Ktor app runs REST examples, and the Apollo app runs GraphQLPlaceholder queries. Both connect to the inspector independently.

### 6. Terminal CLI Preview

```bash
blamebackend --cli
# or: npm run cli
```

---

## Roadmap

See [ROADMAP.md](./ROADMAP.md).

---

## License

```text
Copyright 2026 Cagdas

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
