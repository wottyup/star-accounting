package com.wotty.stark.web;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ScreenshotSource")
public class ScreenshotSourcePlugin extends Plugin {
    @PluginMethod public void pick(PluginCall call) { launch(call, "pick"); }
    @PluginMethod public void remove(PluginCall call) { launch(call, "delete"); }
    @PluginMethod public void forget(PluginCall call) {
        ScreenshotSources.forget(getContext(), call.getString("sourceId"));
        call.resolve();
    }
    private void launch(PluginCall call, String operation) {
        Intent intent = new Intent(getContext(), ScreenshotSourceActivity.class)
                .putExtra("operation", operation).putExtra("sourceId", call.getString("sourceId"));
        try { startActivityForResult(call, intent, "onScreenshotResult"); }
        catch (RuntimeException error) { call.reject("Screenshot action unavailable"); }
    }
    @ActivityCallback private void onScreenshotResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        try {
            String json = result.getData() == null ? null : result.getData().getStringExtra(ScreenshotSourceActivity.RESULT);
            call.resolve(json == null ? new JSObject().put("status", "cancelled") : new JSObject(json));
        } catch (Exception error) { call.reject("Screenshot action unavailable"); }
    }
}
