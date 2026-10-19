plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    `maven-publish`
}

kotlin {
    jvmToolchain(21)

    android {
        namespace = "com.cacaosd.networkinspector"
        compileSdk = 37
        minSdk = 23

        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
        }
    }

    jvm {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
        }
    }

    linuxX64()
    iosArm64()
    iosSimulatorArm64()
    iosX64()

    sourceSets {
        val commonMain = getByName("commonMain")
        val nativeMain = create("nativeMain") {
            dependsOn(commonMain)
        }
        getByName("linuxX64Main").dependsOn(nativeMain)
        getByName("iosArm64Main").dependsOn(nativeMain)
        getByName("iosSimulatorArm64Main").dependsOn(nativeMain)
        getByName("iosX64Main").dependsOn(nativeMain)

        val jvmAndAndroidMain = create("jvmAndAndroidMain") {
            dependsOn(commonMain)
            dependencies {
                implementation(libs.okhttp)
                implementation(libs.logger)
            }
        }

        getByName("androidMain") {
            dependsOn(jvmAndAndroidMain)
        }

        getByName("jvmMain") {
            dependsOn(jvmAndAndroidMain)
        }

        commonMain.dependencies {
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.ktor.client.core)
            implementation(libs.ktor.network)
        }

        getByName("androidMain").dependencies {
            implementation(libs.androidx.core.ktx)
        }
    }
}