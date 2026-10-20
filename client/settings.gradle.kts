pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "BlameBackend"
include(
    ":network-inspector-core",
    ":network-inspector-ktor",
    ":network-inspector-okhttp",
    ":network-inspector-apollo",
    ":network-inspector-test-utils",
)

if (System.getenv().getOrDefault("JITPACK", "false") == "false") {
    include(":app")
    include(":composeApp")
}
