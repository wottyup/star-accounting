package com.wotty.stark.web;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.provider.Settings;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.UUID;

@CapacitorPlugin(name = "FloatingJournal")
public class FloatingJournalPlugin extends Plugin {
    public static final String ACTION_PENDING = "com.wotty.stark.FLOATING_JOURNAL_PENDING";
    public static final String EXTRA_RESULT_CODE = "screenCaptureResultCode";
    public static final String EXTRA_RESULT_DATA = "screenCaptureResultData";
    public static final String PREF_SERVICE_ACTIVE = "service_active";
    public static final String PREF_CAPTURE_ACTIVE = "capture_active";
    public static final String PREF_PENDING_ID = "pending_action_id";
    public static final String PREF_PENDING_MODE = "pending_action_mode";
    public static final String PREF_PENDING_MESSAGE = "pending_action_message";
    public static final String PREF_PENDING_FILE = "pending_action_file";
    private static final String PREFS = "floating_journal";
    private static final long MAX_IMAGE_BYTES = 10L * 1024L * 1024L;
    private BroadcastReceiver actionReceiver;

    @Override
    public void load() {
        super.load();
        actionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                JSObject action = readPendingAction();
                if (action != null) notifyListeners("journalAction", action, false);
            }
        };
        ContextCompat.registerReceiver(
                getContext(), actionReceiver, new IntentFilter(ACTION_PENDING), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        if (actionReceiver != null) {
            try { getContext().unregisterReceiver(actionReceiver); } catch (IllegalArgumentException ignored) { }
            actionReceiver = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSObject status = new JSObject();
        status.put("overlayAllowed", canDrawOverlays());
        boolean active = FloatingJournalService.isRunning() && prefs.getBoolean(PREF_SERVICE_ACTIVE, false);
        status.put("serviceActive", active);
        status.put("captureActive", active && prefs.getBoolean(PREF_CAPTURE_ACTIVE, false));
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
    public void requestScreenCapture(PluginCall call) {
        if (!canDrawOverlays()) {
            call.reject("请先开启悬浮按钮，再设置屏幕识别权限。");
            return;
        }
        MediaProjectionManager manager = (MediaProjectionManager) getContext()
                .getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            call.reject("此设备不支持屏幕识别。");
            return;
        }
        try {
            startActivityForResult(call, manager.createScreenCaptureIntent(), "onScreenCapturePermissionResult");
        } catch (Exception error) {
            call.reject("无法打开系统屏幕共享授权。");
        }
    }

    @ActivityCallback
    private void onScreenCapturePermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject response = new JSObject();
            response.put("enabled", false);
            call.resolve(response);
            return;
        }
        Intent start = new Intent(getContext(), FloatingJournalService.class)
                .setAction(FloatingJournalService.ACTION_ENABLE_CAPTURE)
                .putExtra(EXTRA_RESULT_CODE, result.getResultCode())
                .putExtra(EXTRA_RESULT_DATA, result.getData());
        try {
            startForegroundServiceCompat(start);
            resolveBoolean(call, "enabled", true);
        } catch (Exception error) {
            call.reject("无法启动屏幕识别服务，请重新开启悬浮记账。");
        }
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

    @PluginMethod
    public void stopScreenCapture(PluginCall call) {
        Intent stop = new Intent(getContext(), FloatingJournalService.class)
                .setAction(FloatingJournalService.ACTION_STOP_CAPTURE);
        try {
            getContext().startService(stop);
        } catch (Exception error) {
            call.reject("无法停止屏幕识别服务。");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void getPendingAction(PluginCall call) {
        JSObject action = readPendingAction();
        if (action == null) {
            call.resolve(new JSObject());
            return;
        }
        call.resolve(action);
    }

    @PluginMethod
    public void acknowledgeAction(PluginCall call) {
        String actionId = call.getString("actionId");
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String pendingId = prefs.getString(PREF_PENDING_ID, "");
        if (actionId != null && actionId.equals(pendingId)) {
            deletePendingCapture(prefs.getString(PREF_PENDING_FILE, ""));
            prefs.edit().remove(PREF_PENDING_ID).remove(PREF_PENDING_MODE)
                    .remove(PREF_PENDING_MESSAGE).remove(PREF_PENDING_FILE).apply();
        }
        call.resolve();
    }

    @PluginMethod
    public void selectImage(PluginCall call) {
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        picker.addCategory(Intent.CATEGORY_OPENABLE);
        picker.setType("image/*");
        picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"image/png", "image/jpeg", "image/webp"});
        try {
            startActivityForResult(call, picker, "onImageSelected");
        } catch (Exception error) {
            call.reject("无法打开图片选择器。");
        }
    }

    @ActivityCallback
    private void onImageSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }
        bridge.execute(() -> {
            try {
                String mimeType = getContext().getContentResolver().getType(uri);
                if (!"image/png".equals(mimeType) && !"image/jpeg".equals(mimeType) && !"image/webp".equals(mimeType)) {
                    throw new IllegalArgumentException("请选择 PNG、JPG 或 WebP 图片。");
                }
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                    if (input == null) throw new IllegalStateException("无法读取所选图片。");
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        if ((long) output.size() + read > MAX_IMAGE_BYTES) {
                            throw new IllegalArgumentException("图片超过 10 MiB，请压缩后重试。");
                        }
                        output.write(buffer, 0, read);
                    }
                }
                JSObject selection = new JSObject();
                selection.put("canceled", false);
                selection.put("dataUrl", "data:" + mimeType + ";base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                selection.put("fileName", "floating-upload-" + UUID.randomUUID());
                call.resolve(selection);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "读取图片失败。" : error.getMessage());
            }
        });
    }

    private JSObject readPendingAction() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String actionId = prefs.getString(PREF_PENDING_ID, "");
        String mode = prefs.getString(PREF_PENDING_MODE, "");
        if (actionId == null || actionId.isEmpty() || mode == null || mode.isEmpty()) return null;
        JSObject action = new JSObject();
        action.put("actionId", actionId);
        action.put("mode", mode);
        String message = prefs.getString(PREF_PENDING_MESSAGE, "");
        if (message != null && !message.isEmpty()) action.put("message", message);
        String fileName = prefs.getString(PREF_PENDING_FILE, "");
        if (fileName != null && !fileName.isEmpty()) {
            if (!fileName.matches("floating-screen-[A-Za-z0-9-]+\\.jpg")) {
                action.put("message", "无法读取临时截图，已打开手动记账；也可以上传支付截图。");
            } else {
                File capture = new File(getContext().getCacheDir(), fileName);
                if (capture.isFile() && capture.length() <= MAX_IMAGE_BYTES) {
                    try (InputStream input = new FileInputStream(capture)) {
                        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                        byte[] buffer = new byte[8192];
                        int read;
                        while ((read = input.read(buffer)) != -1) bytes.write(buffer, 0, read);
                        action.put("imageData", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                    } catch (Exception ignored) {
                        action.put("message", "无法读取临时截图，已打开手动记账；也可以上传支付截图。");
                    }
                } else {
                    action.put("message", "没有可用的屏幕截图，已打开手动记账；也可以上传支付截图。");
                }
            }
        }
        return action;
    }

    private void deletePendingCapture(String fileName) {
        if (fileName == null || !fileName.matches("floating-screen-[A-Za-z0-9-]+\\.jpg")) return;
        File capture = new File(getContext().getCacheDir(), fileName);
        //noinspection ResultOfMethodCallIgnored
        capture.delete();
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
