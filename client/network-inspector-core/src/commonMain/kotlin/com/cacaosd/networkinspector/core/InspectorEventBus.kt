package com.cacaosd.networkinspector.core

import com.cacaosd.networkinspector.protocol.NetworkEventDto
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

object InspectorEventBus {
    private var mutableEvents = createEventFlow(DEFAULT_BUFFER_CAPACITY)

    val events
        get() = mutableEvents.asSharedFlow()

    var redactor: HeaderRedactor = HeaderRedactor()
        private set

    var maxBodySizeBytes: Long = DEFAULT_MAX_BODY_SIZE_BYTES
        private set

    fun configure(redactor: HeaderRedactor, maxBodySizeBytes: Long, maxQueueSize: Int) {
        this.redactor = redactor
        this.maxBodySizeBytes = maxBodySizeBytes
        mutableEvents = createEventFlow(maxQueueSize)
    }

    fun dispatch(event: NetworkEventDto) {
        mutableEvents.tryEmit(event)
    }

    private fun createEventFlow(capacity: Int) = MutableSharedFlow<NetworkEventDto>(
        extraBufferCapacity = capacity,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    private const val DEFAULT_BUFFER_CAPACITY = 500
    private const val DEFAULT_MAX_BODY_SIZE_BYTES = 64 * 1024L
}
