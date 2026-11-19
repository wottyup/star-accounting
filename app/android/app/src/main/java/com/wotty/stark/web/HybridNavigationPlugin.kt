package com.wotty.stark.web

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "HybridNavigation")
class HybridNavigationPlugin : Plugin() {
    @PluginMethod
    fun commitTabNavigation(call: PluginCall) {
        val host = activity as? KtHybridActivity
        val path = call.getString("path")
        val requestId = call.getInt("requestId") ?: 0
        if (host == null || path == null || requestId < 0) {
            call.resolve()
            return
        }
        host.runOnUiThread {
            host.commitTabNavigation(path, requestId)
            call.resolve()
        }
    }

    @PluginMethod
    fun prepareSheetLayer(call: PluginCall) {
        val host = activity as? KtHybridActivity
        if (host == null) {
            call.resolve(JSObject().put("active", false))
            return
        }
        host.runOnUiThread {
            try {
                call.resolve(host.prepareSheetNavigationLayer())
            } catch (error: Exception) {
                call.reject("Unable to capture the navigation layer", error)
            }
        }
    }

    @PluginMethod
    fun commitSheetLayer(call: PluginCall) {
        val host = activity as? KtHybridActivity
        val token = call.getInt("token")
        if (host == null || token == null) {
            call.resolve()
            return
        }
        host.runOnUiThread {
            try {
                host.commitSheetNavigationLayer(token) { call.resolve() }
            } catch (error: Exception) {
                call.reject("Unable to display the navigation layer", error)
            }
        }
    }

    @PluginMethod
    fun releaseSheetLayer(call: PluginCall) {
        val host = activity as? KtHybridActivity
        val token = call.getInt("token")
        if (host == null || token == null) {
            call.resolve()
            return
        }
        host.runOnUiThread {
            host.releaseSheetNavigationLayer(token)
            call.resolve()
        }
    }
}
