package com.cacaosd.blamebackend

import android.app.Application
import com.cacaosd.networkinspector.transport.NetworkInspector
import com.cacaosd.networkinspector.transport.install

class BlameBackendApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        NetworkInspector.install(this)
    }
}
