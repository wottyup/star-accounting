package com.wotty.stark.web;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FloatingJournal")
public class FloatingJournalPlugin extends Plugin {
    public static final String PREF_SERVICE_ACTIVE = "service_active";
    private static final String PREFS = "floating_journal";

    @PluginMethod
    public void getStatus(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
        JSObject status = new JSObject();
        status.put("overlayAllowed", canDrawOverlays());
        status.put("serviceActive", FloatingJournalService.isRunning() && prefs.getBoolean(PREF_SERVICE_ACTIVE, false));
        call.resolve(status);
    }

    @PluginMethod
    public void enableOverlay(PluginCall call) {
        if (canDrawOverlays()) {
            startOverlayService();
            resolveBoolean(call, "enabled", true);
            return;
        }
        try {
            Intent permission = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, permission, "onOverlayPermissionResult");
        } catch (Exception error) {
            call.reject("无法打开悬浮窗权限设置，请在系统设置中允许星会计显示在其他应用上层。");
        }
    }

    @ActivityCallback
    private void onOverlayPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        boolean granted = canDrawOverlays();
        if (granted) startOverlayService();
        resolveBoolean(call, "enabled", granted);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        Intent stop = new Intent(getContext(), FloatingJournalService.class)
                .setAction(FloatingJournalService.ACTION_STOP);
        try {
            getContext().startService(stop);
        } catch (Exception ignored) {
            getContext().stopService(new Intent(getContext(), FloatingJournalService.class));
        }
        call.resolve();
    }

    private void startOverlayService() {
        Intent service = new Intent(getContext(), FloatingJournalService.class)
                .setAction(FloatingJournalService.ACTION_ENABLE_OVERLAY);
        startForegroundServiceCompat(service);
    }

    private void startForegroundServiceCompat(Intent intent) {
        if (android.os.Build.VERSION.SDK_INT >= 26) ContextCompat.startForegroundService(getContext(), intent);
        else getContext().startService(intent);
    }

    private boolean canDrawOverlays() {
        return android.os.Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(getContext());
    }

    private void resolveBoolean(PluginCall call, String key, boolean value) {
        JSObject response = new JSObject();
        response.put(key, value);
        call.resolve(response);
    }
}
