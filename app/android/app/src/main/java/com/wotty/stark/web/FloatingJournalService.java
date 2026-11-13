package com.wotty.stark.web;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.HashMap;
import java.util.UUID;

/** User-started floating controls and an in-app journal form overlay. */
public class FloatingJournalService extends Service {
    public static final String ACTION_ENABLE_OVERLAY = "com.wotty.stark.action.ENABLE_FLOATING_OVERLAY";
    public static final String ACTION_STOP = "com.wotty.stark.action.STOP_FLOATING_JOURNAL";
    private static final String PREFS = "floating_journal";
    private static final String NOTIFICATION_CHANNEL = "floating-journal";
    private static final int NOTIFICATION_ID = 7321;
    private static volatile boolean running;
    private static volatile FloatingJournalService currentService;

    private final Handler mainHandler = new Handler();
    private WindowManager windowManager;
    private LinearLayout overlayRoot;
    private ImageView bubble;
    private WindowManager.LayoutParams overlayParams;
    private FrameLayout journalOverlayRoot;
    private WebView journalWebView;
    private TextView journalOverlayErrorClose;
    private WindowManager.LayoutParams journalOverlayParams;
    private boolean journalOverlayAttached;
    private String journalOverlayExpectedUrl;
    private Runnable journalOverlayReadyTimeout;
    private ValueCallback<Uri[]> fileChooserCallback;
    private float touchDownX;
    private float touchDownY;
    private int touchStartX;
    private int touchStartY;
    private boolean dragged;

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        currentService = this;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_ENABLE_OVERLAY : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopEverything();
            return START_NOT_STICKY;
        }
        startForegroundSafely();
        if (canDrawOverlays()) {
            addOverlayIfNeeded();
            setServiceState(true);
        } else {
            setServiceState(false);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        removeOverlay();
        removeJournalOverlay();
        setServiceState(false);
        stopForeground(true);
        if (currentService == this) currentService = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    public static boolean isRunning() {
        return running;
    }

    public static boolean closeVisibleJournalOverlayFromBack() {
        FloatingJournalService service = currentService;
        if (service == null || service.journalOverlayRoot == null || !service.journalOverlayAttached
                || service.journalOverlayRoot.getVisibility() != View.VISIBLE) return false;
        service.closeJournalOverlay();
        return true;
    }

    private void startForegroundSafely() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, 0);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent content = launch == null ? null : PendingIntent.getActivity(
                this, 7321, launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                pendingIntentFlags());
        Intent stop = new Intent(this, FloatingJournalService.class).setAction(ACTION_STOP);
        PendingIntent stopAction = PendingIntent.getService(this, 7322, stop, pendingIntentFlags());
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, NOTIFICATION_CHANNEL)
                : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_menu_edit)
                .setContentTitle("星会计悬浮记账已开启")
                .setContentText("点击悬浮按钮直接打开记账表单")
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "关闭", stopAction);
        if (content != null) builder.setContentIntent(content);
        return builder.build();
    }

    private int pendingIntentFlags() {
        return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(
                NOTIFICATION_CHANNEL, "悬浮记账", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("悬浮记账按钮和当前应用上方的记账表单");
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void openJournalOverlay() {
        if (android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) {
            mainHandler.post(this::openJournalOverlay);
            return;
        }
        if (!canDrawOverlays() || windowManager == null) {
            android.widget.Toast.makeText(this, "请先开启星会计悬浮窗权限。", android.widget.Toast.LENGTH_LONG).show();
            return;
        }
        if (overlayRoot == null) addOverlayIfNeeded();
        if (journalOverlayRoot == null) createJournalOverlay();
        String targetUrl = "http://localhost/app/journal/?floating=1&session=" + UUID.randomUUID();
        journalOverlayExpectedUrl = targetUrl;
        journalOverlayRoot.setVisibility(View.INVISIBLE);
        journalOverlayParams.flags = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        try {
            if (!journalOverlayAttached) {
                windowManager.addView(journalOverlayRoot, journalOverlayParams);
                journalOverlayAttached = true;
            } else {
                windowManager.updateViewLayout(journalOverlayRoot, journalOverlayParams);
            }
            if (journalOverlayErrorClose != null) journalOverlayErrorClose.setVisibility(View.GONE);
            journalWebView.loadUrl(targetUrl);
        } catch (RuntimeException error) {
            journalOverlayExpectedUrl = null;
            if (journalOverlayAttached) {
                try { windowManager.removeView(journalOverlayRoot); } catch (RuntimeException ignored) { }
                journalOverlayAttached = false;
            }
            if (overlayRoot != null) overlayRoot.setVisibility(View.VISIBLE);
            android.widget.Toast.makeText(this, "悬浮记账页面暂时无法打开，请重新开启悬浮记账。", android.widget.Toast.LENGTH_LONG).show();
        }
    }

    private void createJournalOverlay() {
        journalOverlayRoot = new FrameLayout(this);
        journalOverlayRoot.setBackgroundColor(Color.TRANSPARENT);
        journalOverlayRoot.setFocusableInTouchMode(true);
        journalOverlayRoot.setVisibility(View.INVISIBLE);

        journalWebView = new WebView(this);
        WebSettings settings = journalWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " WottyStarkFloatingOverlay");
        journalWebView.setBackgroundColor(Color.TRANSPARENT);
        journalWebView.addJavascriptInterface(new FloatingOverlayBridge(), "AndroidFloatingJournal");
        journalWebView.setWebViewClient(new WebViewClient() {
            @Nullable
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveLocalAsset(request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !isLocalAppUrl(uri);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) {
                    mainHandler.post(() -> {
                        failJournalOverlay(journalOverlayExpectedUrl);
                    });
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (journalOverlayErrorClose != null) journalOverlayErrorClose.setVisibility(View.GONE);
                String expectedUrl = journalOverlayExpectedUrl;
                if (expectedUrl != null && expectedUrl.equals(url)) scheduleJournalOverlayReadyTimeout(expectedUrl);
            }
        });
        journalWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return launchFilePicker(callback, params);
            }
        });
        journalOverlayRoot.addView(journalWebView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        journalOverlayErrorClose = new TextView(this);
        journalOverlayErrorClose.setText("关闭");
        journalOverlayErrorClose.setTextColor(Color.WHITE);
        journalOverlayErrorClose.setTextSize(14);
        journalOverlayErrorClose.setGravity(Gravity.CENTER);
        journalOverlayErrorClose.setBackground(background(0xFF3178DC, dp(20), 0x00000000));
        journalOverlayErrorClose.setVisibility(View.GONE);
        journalOverlayErrorClose.setOnClickListener(view -> closeJournalOverlay());
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(dp(64), dp(40), Gravity.TOP | Gravity.END);
        closeParams.topMargin = dp(44);
        closeParams.rightMargin = dp(12);
        journalOverlayRoot.addView(journalOverlayErrorClose, closeParams);

        int overlayType = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        DisplayMetrics overlayMetrics = getResources().getDisplayMetrics();
        int currentOverlayHeight = Math.max(dp(400), Math.min(dp(760), overlayMetrics.heightPixels - dp(80)));
        int overlayHeight = Math.max(dp(320), Math.round(currentOverlayHeight * 0.8f));
        journalOverlayParams = new WindowManager.LayoutParams(
                Math.max(dp(260), Math.min(dp(420), overlayMetrics.widthPixels - dp(72))),
                overlayHeight,
                overlayType,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT);
        journalOverlayParams.gravity = Gravity.CENTER;
        journalOverlayParams.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
    }

    private void scheduleJournalOverlayReadyTimeout(String expectedUrl) {
        cancelJournalOverlayReadyTimeout();
        journalOverlayReadyTimeout = () -> failJournalOverlay(expectedUrl);
        mainHandler.postDelayed(journalOverlayReadyTimeout, 12_000L);
    }

    private void cancelJournalOverlayReadyTimeout() {
        if (journalOverlayReadyTimeout != null) {
            mainHandler.removeCallbacks(journalOverlayReadyTimeout);
            journalOverlayReadyTimeout = null;
        }
    }

    private void failJournalOverlay(String expectedUrl) {
        if (expectedUrl == null || !expectedUrl.equals(journalOverlayExpectedUrl)) return;
        journalOverlayExpectedUrl = null;
        cancelJournalOverlayReadyTimeout();
        if (journalOverlayAttached && windowManager != null && journalOverlayRoot != null) {
            try { windowManager.removeView(journalOverlayRoot); } catch (RuntimeException ignored) { }
            journalOverlayAttached = false;
        }
        if (overlayRoot != null) overlayRoot.setVisibility(View.VISIBLE);
        android.widget.Toast.makeText(this, "悬浮记账页面加载失败，请重试。", android.widget.Toast.LENGTH_LONG).show();
    }

    private void presentJournalOverlay(String expectedUrl) {
        if (expectedUrl == null || !expectedUrl.equals(journalOverlayExpectedUrl)
                || journalOverlayRoot == null || journalOverlayParams == null || windowManager == null) return;
        journalOverlayExpectedUrl = null;
        cancelJournalOverlayReadyTimeout();
        journalOverlayParams.flags = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;
        try {
            if (journalOverlayAttached) {
                windowManager.updateViewLayout(journalOverlayRoot, journalOverlayParams);
            } else {
                windowManager.addView(journalOverlayRoot, journalOverlayParams);
                journalOverlayAttached = true;
            }
            if (overlayRoot != null) overlayRoot.setVisibility(View.GONE);
            journalOverlayRoot.setVisibility(View.VISIBLE);
        } catch (RuntimeException error) {
            journalOverlayExpectedUrl = null;
            if (overlayRoot != null) overlayRoot.setVisibility(View.VISIBLE);
            android.widget.Toast.makeText(this, "悬浮记账页面暂时无法显示，请重新开启悬浮记账。", android.widget.Toast.LENGTH_LONG).show();
        }
    }

    private boolean isLocalAppUrl(Uri uri) {
        if (uri == null || !"http".equalsIgnoreCase(uri.getScheme()) || !"localhost".equalsIgnoreCase(uri.getHost())) return false;
        int port = uri.getPort();
        return port == -1 || port == 80;
    }

    @Nullable
    private WebResourceResponse serveLocalAsset(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!isLocalAppUrl(uri) || !"GET".equalsIgnoreCase(request.getMethod())) return null;
        String path = uri.getPath();
        if (path == null || path.contains("..")) return null;
        String relativePath = path.startsWith("/") ? path.substring(1) : path;
        String assetPath = "public/" + relativePath;
        if (relativePath.isEmpty() || relativePath.endsWith("/")) assetPath += "index.html";
        InputStream stream = openAsset(assetPath);
        if (stream == null && !relativePath.isEmpty() && !relativePath.contains(".")) {
            stream = openAsset("public/" + relativePath + "/index.html");
            if (stream == null) stream = openAsset("public/" + relativePath + ".html");
        }
        if (stream == null) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    Collections.singletonMap("Cache-Control", "no-store"),
                    new ByteArrayInputStream("Not found".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
        return new WebResourceResponse(mimeType(assetPath), "UTF-8", 200, "OK",
                Collections.singletonMap("Cache-Control", "no-cache"), stream);
    }

    @Nullable
    private InputStream openAsset(String path) {
        try { return getAssets().open(path); } catch (IOException ignored) { return null; }
    }

    private String mimeType(String path) {
        String lower = path.toLowerCase(java.util.Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private boolean launchFilePicker(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
        fileChooserCallback = callback;
        try {
            Intent picker = new Intent(this, FloatingJournalFilePickerActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(FloatingJournalFilePickerActivity.EXTRA_CHOOSER_INTENT, params.createIntent());
            hideJournalOverlayForFilePicker();
            startActivity(picker);
            return true;
        } catch (RuntimeException error) {
            fileChooserCallback = null;
            callback.onReceiveValue(null);
            restoreJournalOverlayAfterFilePicker();
            return false;
        }
    }

    private void hideJournalOverlayForFilePicker() {
        if (journalOverlayRoot == null) return;
        journalOverlayRoot.setVisibility(View.GONE);
        if (!journalOverlayAttached || windowManager == null) return;
        try {
            windowManager.removeView(journalOverlayRoot);
            journalOverlayAttached = false;
        } catch (RuntimeException ignored) { }
    }

    private void restoreJournalOverlayAfterFilePicker() {
        if (journalOverlayRoot == null || windowManager == null) return;
        try {
            if (!journalOverlayAttached) {
                windowManager.addView(journalOverlayRoot, journalOverlayParams);
                journalOverlayAttached = true;
            }
            journalOverlayRoot.setVisibility(View.VISIBLE);
        } catch (RuntimeException ignored) { }
    }

    public static void deliverFileSelection(@Nullable Uri[] selected) {
        FloatingJournalService service = currentService;
        if (service == null) return;
        service.mainHandler.post(() -> {
            ValueCallback<Uri[]> callback = service.fileChooserCallback;
            service.fileChooserCallback = null;
            if (callback != null) callback.onReceiveValue(selected);
            service.restoreJournalOverlayAfterFilePicker();
        });
    }

    private void closeJournalOverlay() {
        mainHandler.post(() -> {
            journalOverlayExpectedUrl = null;
            cancelJournalOverlayReadyTimeout();
            if (journalOverlayAttached && windowManager != null && journalOverlayRoot != null) {
                try { windowManager.removeView(journalOverlayRoot); } catch (RuntimeException ignored) { }
                journalOverlayAttached = false;
            }
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = null;
            }
            if (overlayRoot != null) overlayRoot.setVisibility(View.VISIBLE);
        });
    }

    private void removeJournalOverlay() {
        journalOverlayExpectedUrl = null;
        cancelJournalOverlayReadyTimeout();
        if (journalOverlayAttached && windowManager != null && journalOverlayRoot != null) {
            try { windowManager.removeView(journalOverlayRoot); } catch (RuntimeException ignored) { }
        }
        journalOverlayAttached = false;
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
        if (journalWebView != null) {
            journalWebView.stopLoading();
            journalWebView.removeJavascriptInterface("AndroidFloatingJournal");
            journalWebView.destroy();
            journalWebView = null;
        }
        journalOverlayRoot = null;
        journalOverlayErrorClose = null;
        journalOverlayParams = null;
    }

    private final class FloatingOverlayBridge {
        @JavascriptInterface
        public void onFormReady() {
            mainHandler.post(() -> {
                String expectedUrl = journalOverlayExpectedUrl;
                if (expectedUrl != null) presentJournalOverlay(expectedUrl);
            });
        }

        @JavascriptInterface
        public void close() {
            closeJournalOverlay();
        }
    }

    private void setServiceState(boolean active) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putBoolean(FloatingJournalPlugin.PREF_SERVICE_ACTIVE, active)
                .apply();
    }

    private void addOverlayIfNeeded() {
        if (windowManager == null || overlayRoot != null || !canDrawOverlays()) return;
        overlayRoot = new LinearLayout(this);
        overlayRoot.setOrientation(LinearLayout.VERTICAL);
        overlayRoot.setGravity(Gravity.END);

        bubble = new ImageView(this);
        bubble.setImageResource(R.drawable.ic_launcher_vector);
        bubble.setScaleType(ImageView.ScaleType.FIT_CENTER);
        bubble.setContentDescription("星会计记账");
        bubble.setFocusable(true);
        bubble.setClickable(true);
        bubble.setOnClickListener(view -> openJournalOverlay());
        LinearLayout.LayoutParams bubbleParams = new LinearLayout.LayoutParams(dp(48), dp(48));
        overlayRoot.addView(bubble, bubbleParams);
        bubble.setOnTouchListener(this::onBubbleTouch);

        int overlayType = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        overlayParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        overlayParams.gravity = Gravity.TOP | Gravity.END;
        overlayParams.x = dp(8);
        overlayParams.y = dp(180);
        try {
            windowManager.addView(overlayRoot, overlayParams);
        } catch (RuntimeException error) {
            overlayRoot = null;
            bubble = null;
        }
    }

    private boolean onBubbleTouch(View view, MotionEvent event) {
        if (overlayParams == null || windowManager == null) return false;
        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                touchDownX = event.getRawX();
                touchDownY = event.getRawY();
                touchStartX = overlayParams.x;
                touchStartY = overlayParams.y;
                dragged = false;
                return true;
            case MotionEvent.ACTION_MOVE:
                float dx = event.getRawX() - touchDownX;
                float dy = event.getRawY() - touchDownY;
                if (Math.abs(dx) + Math.abs(dy) > dp(7)) dragged = true;
                if (dragged) {
                    overlayParams.x = Math.max(0, touchStartX - Math.round(dx));
                    overlayParams.y = Math.max(0, touchStartY + Math.round(dy));
                    try { windowManager.updateViewLayout(overlayRoot, overlayParams); } catch (RuntimeException ignored) { }
                }
                return true;
            case MotionEvent.ACTION_UP:
                if (!dragged) view.performClick();
                return true;
            default:
                return false;
        }
    }

    private void removeOverlay() {
        if (windowManager != null && overlayRoot != null) {
            try { windowManager.removeView(overlayRoot); } catch (RuntimeException ignored) { }
        }
        overlayRoot = null;
        bubble = null;
    }

    private void stopEverything() {
        removeOverlay();
        removeJournalOverlay();
        setServiceState(false);
        stopForeground(true);
        stopSelf();
    }

    private GradientDrawable background(int color, int radius, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        if (stroke != 0) drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private boolean canDrawOverlays() {
        return Build.VERSION.SDK_INT < 23 || android.provider.Settings.canDrawOverlays(this);
    }
}
