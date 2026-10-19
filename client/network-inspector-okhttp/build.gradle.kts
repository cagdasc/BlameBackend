plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kotlin.multiplatform)
    `maven-publish`
}

kotlin {
    jvmToolchain(21)

    android {
        namespace = "com.cacaosd.networkinspector.okhttp"
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

    sourceSets {
        val commonMain = getByName("commonMain")
        val jvmAndAndroidMain = create("jvmAndAndroidMain") {
            dependsOn(commonMain)
            dependencies {
                api(project(":network-inspector-core"))
                api(libs.okhttp)
            }
        }
        getByName("jvmMain").dependsOn(jvmAndAndroidMain)
        getByName("androidMain").dependsOn(jvmAndAndroidMain)

        getByName("jvmTest").dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.core)
            implementation(project(":network-inspector-test-utils"))
        }
    }
}
