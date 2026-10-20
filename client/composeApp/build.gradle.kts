plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kotlin.multiplatform)
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.apollo)
}

apollo {
    service("placeholder") {
        packageName.set("com.cacaosd.blamebackend.placeholder")

        introspection {
            endpointUrl.set("https://graphqlplaceholder.vercel.app/graphql")
            schemaFile.set(file("src/commonMain/graphql/schema.graphqls"))
        }
    }
}

kotlin {
    jvmToolchain(21)

    android {
        namespace = "com.cacaosd.blamebackend.shared"
        compileSdk = 37
        minSdk = 29

        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
        }
    }

    jvm()
    linuxX64 {
        binaries {
            executable {
                entryPoint = "com.cacaosd.blamebackend.linux.main"
            }
        }
    }

    sourceSets {
        val commonMain = getByName("commonMain")
        val composeMain = create("composeMain") {
            dependsOn(commonMain)
            dependencies {
                implementation(compose.runtime)
                implementation(compose.foundation)
                implementation(compose.material3)
                implementation(compose.ui)
                implementation(libs.ktor.client.core)
                implementation(libs.ktor.client.content.negotiation)
                implementation(libs.ktor.serialization.kotlinx.json)
                implementation(libs.kotlinx.serialization.json)
                implementation(project(":network-inspector-apollo"))
            }
        }
        getByName("androidMain").dependsOn(composeMain)
        getByName("jvmMain").dependsOn(composeMain)

        commonMain.dependencies {
            implementation(project(":network-inspector-core"))
            implementation(project(":network-inspector-ktor"))
            implementation(libs.apollo.runtime)
        }

        getByName("androidMain").dependencies {
            implementation(project(":network-inspector-okhttp"))
            implementation(libs.okhttp)
            implementation(libs.ktor.client.cio)
            implementation(libs.ktor.client.okhttp)
        }

        getByName("jvmMain").dependencies {
            implementation(project(":network-inspector-okhttp"))
            implementation(libs.okhttp)
            implementation(libs.ktor.client.cio)
            implementation(libs.ktor.client.okhttp)
            implementation(compose.desktop.currentOs)
        }

        getByName("linuxX64Main").dependencies {
            implementation(compose.runtime)
            implementation(libs.ktor.client.core)
            implementation(libs.ktor.client.curl)
        }

        jvmTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

compose.desktop {
    application {
        mainClass = "com.cacaosd.blamebackend.desktop.MainKt"
    }
}
