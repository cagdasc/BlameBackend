plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}

android {
    namespace = "com.cacaosd.blamebackend"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.cacaosd.blamebackend"
        minSdk = 29
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            optimization {
                enable = false
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "META-INF/INDEX.LIST"
        }
    }
}

dependencies {
    implementation(libs.androidx.activity.compose)
    implementation(libs.material)
    implementation(project(":composeApp"))
    implementation(project(":network-inspector-core"))
    implementation(libs.androidx.core.ktx)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
}