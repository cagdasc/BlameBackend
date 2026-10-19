plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    `maven-publish`
}

kotlin {
    jvmToolchain(21)

    android {
        namespace = "com.cacaosd.networkinspector.core"
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

        commonMain.dependencies {
            api(libs.kotlinx.coroutines.core)
            api(libs.kotlinx.serialization.json)
            implementation(libs.ktor.network)
        }

        commonTest.dependencies {
            implementation(kotlin("test"))
        }

        getByName("jvmMain").dependencies {
            implementation(libs.logging.kotlin)
            runtimeOnly(libs.logging.logback.classic)
        }

        getByName("jvmTest").dependencies {
            implementation(kotlin("test"))
        }
    }
}
