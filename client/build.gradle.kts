// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.android.kotlin.multiplatform) apply false
    alias(libs.plugins.compose.multiplatform) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.compose.compiler) apply false
}

val isJitPackBuild = providers.environmentVariable("JITPACK").orNull == "true"
val publicationGroup = if (isJitPackBuild) {
    val jitPackGroup = providers.environmentVariable("GROUP").orElse("com.github.cagdasc").get()
    val jitPackArtifact = providers.environmentVariable("ARTIFACT").orElse(rootProject.name).get()
    "$jitPackGroup.$jitPackArtifact"
} else {
    "com.cacaosd"
}
val publicationVersion = if (isJitPackBuild) {
    providers.environmentVariable("VERSION").orElse("0.0.1").get()
} else {
    "0.0.1"
}

allprojects {
    group = publicationGroup
    version = publicationVersion
}