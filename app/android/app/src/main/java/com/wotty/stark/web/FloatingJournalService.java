package com.wotty.stark.web;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Base64;
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
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.HashMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import org.json.JSONObject;

/** User-started floating controls and on-demand screen capture for journal entry. */
public class FloatingJournalService extends Service {
    public static final String ACTION_ENABLE_OVERLAY = "com.wotty.stark.action.ENABLE_FLOATING_OVERLAY";
    public static final String ACTION_ENABLE_CAPTURE = "com.wotty.stark.action.ENABLE_SCREEN_CAPTURE";
    public static final String ACTION_STOP_CAPTURE = "com.wotty.stark.action.STOP_SCREEN_CAPTURE";
    public static final String ACTION_STOP = "com.wotty.stark.action.STOP_FLOATING_JOURNAL";
    private static final String ACTION_CAPTURE_SCREEN = "com.wotty.stark.action.CAPTURE_CURRENT_SCREEN";
    private static final String ACTION_UPLOAD_IMAGE = "com.wotty.stark.action.UPLOAD_JOURNAL_IMAGE";
    private static final String ACTION_OPEN_MANUAL = "com.wotty.stark.action.OPEN_MANUAL_JOURNAL";
    private static final String PREFS = "floating_journal";
    private static final String PREF_OVERLAY_PENDING_ID = "overlay_pending_action_id";
    private static final String PREF_OVERLAY_PENDING_MODE = "overlay_pending_action_mode";
    private static final String PREF_OVERLAY_PENDING_MESSAGE = "overlay_pending_action_message";
    private static final String PREF_OVERLAY_PENDING_FILE = "overlay_pending_action_file";
    private static final long MAX_CAPTURE_BYTES = 10L * 1024L * 1024L;
    private static final String NOTIFICATION_CHANNEL = "floating-journal";
    private static final int NOTIFICATION_ID = 7321;
    private static final long CAPTURE_TIMEOUT_MS = 5_000L;
    private static volatile boolean running;
    private static volatile FloatingJournalService currentService;

    private final AtomicBoolean captureRequested = new AtomicBoolean(false);
    private final AtomicBoolean captureInProgress = new AtomicBoolean(false);
    private final Handler mainHandler = new Handler();
    private WindowManager windowManager;
    private LinearLayout overlayRoot;
    private LinearLayout menuPanel;
    private TextView bubble;
    private WindowManager.LayoutParams overlayParams;
    private FrameLayout journalOverlayRoot;
    private WebView journalWebView;
    private TextView journalOverlayErrorClose;
    private WindowManager.LayoutParams journalOverlayParams;
    private boolean journalOverlayAttached;
    private String journalOverlayExpectedUrl;
    private Runnable journalOverlayReadyTimeout;
    private ValueCallback<Uri[]> fileChooserCallback;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private int screenWidth;
    private int screenHeight;
    private int screenDensity;
    private float touchDownX;
    private float touchDownY;
    private int touchStartX;
    private int touchStartY;
    private boolean dragged;
    private boolean shuttingDown;

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        currentService = this;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        createNotificationChannel();
        startCaptureThread();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_ENABLE_OVERLAY : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopEverything();
            return START_NOT_STICKY;
        }
        if (ACTION_STOP_CAPTURE.equals(action)) {
            stopProjection();
            setServiceState(true, false);
            startForegroundSafely(false);
            NotificationManager notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (notificationManager != null) notificationManager.notify(NOTIFICATION_ID, buildNotification());
            return START_NOT_STICKY;
        }

        boolean startCapture = ACTION_ENABLE_CAPTURE.equals(action);
        startForegroundSafely(startCapture);
        if (canDrawOverlays()) {
            addOverlayIfNeeded();
            setServiceState(true, mediaProjection != null);
        }

        if (startCapture && intent != null) {
            int resultCode = intent.getIntExtra(FloatingJournalPlugin.EXTRA_RESULT_CODE, 0);
            Intent resultData = getParcelableIntent(intent, FloatingJournalPlugin.EXTRA_RESULT_DATA);
            if (resultData != null) startScreenCapture(resultCode, resultData);
        } else if (ACTION_CAPTURE_SCREEN.equals(action)) {
            captureCurrentScreen();
        } else if (ACTION_UPLOAD_IMAGE.equals(action)) {
            publishAction("upload", null, null);
        } else if (ACTION_OPEN_MANUAL.equals(action)) {
            clearOverlayPendingAction();
            openJournalOverlay();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        shuttingDown = true;
        running = false;
        removeOverlay();
        removeJournalOverlay();
        stopProjection();
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
            captureHandler = null;
        }
        setServiceState(false, false);
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

    private Intent getParcelableIntent(Intent source, String key) {
        if (Build.VERSION.SDK_INT >= 33) return source.getParcelableExtra(key, Intent.class);
        //noinspection deprecation
        return source.getParcelableExtra(key);
    }

    private void startForegroundSafely(boolean includeProjection) {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 34) {
            int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
            if (includeProjection || mediaProjection != null) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
            startForeground(NOTIFICATION_ID, notification, type);
        } else if (Build.VERSION.SDK_INT >= 29) {
            int type = includeProjection || mediaProjection != null
                    ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                    : 0;
            startForeground(NOTIFICATION_ID, notification, type);
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
                .setContentText(mediaProjection == null ? "可上传图片识别或打开手动记账" : "点击悬浮按钮识别当前屏幕")
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
        channel.setDescription("悬浮记账按钮和用户主动开启的屏幕识别会话");
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void startCaptureThread() {
        captureThread = new HandlerThread("stark-screen-capture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());
    }

    private void startScreenCapture(int resultCode, Intent resultData) {
        try {
            MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            mediaProjection = manager.getMediaProjection(resultCode, resultData);
            if (mediaProjection == null) throw new IllegalStateException("Screen capture permission was not granted");
            DisplayMetrics metrics = getResources().getDisplayMetrics();
            int physicalWidth = Math.max(1, metrics.widthPixels);
            int physicalHeight = Math.max(1, metrics.heightPixels);
            float scale = Math.min(1f, 2000f / Math.max(physicalWidth, physicalHeight));
            screenWidth = Math.max(1, Math.round(physicalWidth * scale));
            screenHeight = Math.max(1, Math.round(physicalHeight * scale));
            screenDensity = Math.max(1, Math.round(metrics.densityDpi * scale));
            imageReader = ImageReader.newInstance(screenWidth, screenHeight, PixelFormat.RGBA_8888, 3);
            imageReader.setOnImageAvailableListener(this::onImageAvailable, captureHandler);
            virtualDisplay = mediaProjection.createVirtualDisplay(
                    "StarAccountingScreenRecognition",
                    screenWidth,
                    screenHeight,
                    screenDensity,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    imageReader.getSurface(),
                    null,
                    captureHandler);
            mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    if (shuttingDown) return;
                    stopProjection();
                    setServiceState(true, false);
                    startForegroundSafely(false);
                }
            }, captureHandler);
            setServiceState(true, true);
            startForegroundSafely(true);
            NotificationManager notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (notificationManager != null) notificationManager.notify(NOTIFICATION_ID, buildNotification());
        } catch (Exception error) {
            stopProjection();
            setServiceState(true, false);
            NotificationManager notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (notificationManager != null) notificationManager.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private void stopProjection() {
        captureRequested.set(false);
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (imageReader != null) {
            imageReader.setOnImageAvailableListener(null, null);
            imageReader.close();
            imageReader = null;
        }
        MediaProjection projection = mediaProjection;
        mediaProjection = null;
        if (projection != null) {
            try { projection.stop(); } catch (RuntimeException ignored) { }
        }
    }

    private void captureCurrentScreen() {
        if (mediaProjection == null || imageReader == null || captureHandler == null) {
            publishAction("screen", "先在设置中允许屏幕共享；已打开手动记账，也可以上传支付截图。", null);
            return;
        }
        if (!captureInProgress.compareAndSet(false, true)) return;
        captureRequested.set(false);
        setOverlayVisible(false);
        captureHandler.postDelayed(() -> drainStaleFramesAndWait(), 250L);
        mainHandler.postDelayed(() -> {
            if (!captureInProgress.compareAndSet(true, false)) return;
            captureRequested.set(false);
            setOverlayVisible(true);
            publishAction("screen", "没有读取到屏幕画面，已打开手动记账；也可以上传支付截图。", null);
        }, CAPTURE_TIMEOUT_MS);
    }

    private void drainStaleFramesAndWait() {
        if (!captureInProgress.get() || imageReader == null) return;
        Image stale;
        while ((stale = imageReader.acquireLatestImage()) != null) stale.close();
        captureHandler.postDelayed(() -> {
            if (!captureInProgress.get() || imageReader == null) return;
            captureRequested.set(true);
        }, 80L);
    }

    private void onImageAvailable(ImageReader reader) {
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null || !captureRequested.compareAndSet(true, false)) return;
            captureInProgress.set(false);
            Bitmap bitmap = imageToBitmap(image);
            if (bitmap == null) {
                publishCaptureFailure("没有读取到屏幕画面，已打开手动记账；也可以上传支付截图。");
                return;
            }
            if (isProtectedOrBlank(bitmap)) {
                bitmap.recycle();
                publishCaptureFailure("当前支付页面禁止截屏，已打开手动记账；也可以上传支付截图。");
                return;
            }
            File captureFile = saveCapture(bitmap);
            bitmap.recycle();
            if (captureFile == null) {
                publishCaptureFailure("屏幕截图暂时无法读取，已打开手动记账；也可以上传支付截图。");
                return;
            }
            publishAction("screen", null, captureFile.getName());
        } catch (Exception error) {
            captureRequested.set(false);
            publishCaptureFailure("屏幕识别暂不可用，已打开手动记账；也可以上传支付截图。");
        } finally {
            if (image != null) image.close();
            mainHandler.post(() -> setOverlayVisible(true));
        }
    }

    private Bitmap imageToBitmap(Image image) {
        Image.Plane[] planes = image.getPlanes();
        if (planes.length == 0) return null;
        Image.Plane plane = planes[0];
        ByteBuffer buffer = plane.getBuffer();
        int pixelStride = plane.getPixelStride();
        int rowStride = plane.getRowStride();
        int paddedWidth = rowStride / Math.max(1, pixelStride);
        Bitmap padded = Bitmap.createBitmap(paddedWidth, image.getHeight(), Bitmap.Config.ARGB_8888);
        buffer.rewind();
        padded.copyPixelsFromBuffer(buffer);
        Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, image.getWidth(), image.getHeight());
        if (cropped != padded) padded.recycle();
        int largest = Math.max(cropped.getWidth(), cropped.getHeight());
        if (largest <= 1600) return cropped;
        float scale = 1600f / largest;
        Bitmap resized = Bitmap.createScaledBitmap(
                cropped,
                Math.max(1, Math.round(cropped.getWidth() * scale)),
                Math.max(1, Math.round(cropped.getHeight() * scale)),
                true);
        cropped.recycle();
        return resized;
    }

    private boolean isProtectedOrBlank(Bitmap bitmap) {
        Bitmap sample = Bitmap.createScaledBitmap(bitmap, 64, 64, true);
        int darkPixels = 0;
        for (int y = 0; y < sample.getHeight(); y++) {
            for (int x = 0; x < sample.getWidth(); x++) {
                int pixel = sample.getPixel(x, y);
                if (Color.red(pixel) < 18 && Color.green(pixel) < 18 && Color.blue(pixel) < 18) darkPixels++;
            }
        }
        sample.recycle();
        return darkPixels >= 64 * 64 * 98 / 100;
    }

    private File saveCapture(Bitmap bitmap) {
        File file = new File(getCacheDir(), "floating-screen-" + UUID.randomUUID() + ".jpg");
        try (FileOutputStream output = new FileOutputStream(file)) {
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 84, output)) throw new IllegalStateException("JPEG compression failed");
            output.flush();
            return file;
        } catch (Exception error) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            return null;
        }
    }

    private void publishCaptureFailure(String message) {
        captureRequested.set(false);
        captureInProgress.set(false);
        publishAction("screen", message, null);
    }

    private void publishAction(String mode, @Nullable String message, @Nullable String fileName) {
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        String previousFile = preferences.getString(PREF_OVERLAY_PENDING_FILE, "");
        if (previousFile != null && previousFile.matches("floating-screen-[A-Za-z0-9-]+\\.jpg")) {
            //noinspection ResultOfMethodCallIgnored
            new File(getCacheDir(), previousFile).delete();
        }
        String actionId = UUID.randomUUID().toString();
        preferences.edit()
                .putString(PREF_OVERLAY_PENDING_ID, actionId)
                .putString(PREF_OVERLAY_PENDING_MODE, mode)
                .putString(PREF_OVERLAY_PENDING_MESSAGE, message == null ? "" : message)
                .putString(PREF_OVERLAY_PENDING_FILE, fileName == null ? "" : fileName)
                .apply();
        openJournalOverlay();
    }

    private void clearOverlayPendingAction() {
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        deletePendingCapture(preferences.getString(PREF_OVERLAY_PENDING_FILE, ""));
        preferences.edit().remove(PREF_OVERLAY_PENDING_ID).remove(PREF_OVERLAY_PENDING_MODE)
                .remove(PREF_OVERLAY_PENDING_MESSAGE).remove(PREF_OVERLAY_PENDING_FILE).apply();
    }

    private void deletePendingCapture(String fileName) {
        if (fileName == null || !fileName.matches("floating-screen-[A-Za-z0-9-]+\\.jpg")) return;
        File capture = new File(getCacheDir(), fileName);
        //noinspection ResultOfMethodCallIgnored
        capture.delete();
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
        if (menuPanel != null) menuPanel.setVisibility(View.GONE);
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
        journalOverlayParams = new WindowManager.LayoutParams(
                Math.max(dp(260), Math.min(dp(420), overlayMetrics.widthPixels - dp(72))),
                Math.max(dp(400), Math.min(dp(760), overlayMetrics.heightPixels - dp(80))),
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
        public String getPendingAction() {
            SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
            String actionId = preferences.getString(PREF_OVERLAY_PENDING_ID, "");
            String mode = preferences.getString(PREF_OVERLAY_PENDING_MODE, "");
            if (actionId == null || actionId.isEmpty() || mode == null || mode.isEmpty()) return "";
            try {
                JSONObject action = new JSONObject();
                action.put("actionId", actionId);
                action.put("mode", mode);
                String message = preferences.getString(PREF_OVERLAY_PENDING_MESSAGE, "");
                if (message != null && !message.isEmpty()) action.put("message", message);
                String fileName = preferences.getString(PREF_OVERLAY_PENDING_FILE, "");
                if (fileName != null && fileName.matches("floating-screen-[A-Za-z0-9-]+\\.jpg")) {
                    File capture = new File(getCacheDir(), fileName);
                    if (capture.isFile() && capture.length() <= MAX_CAPTURE_BYTES) {
                        try (InputStream input = new FileInputStream(capture); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                            byte[] buffer = new byte[8192];
                            int read;
                            while ((read = input.read(buffer)) != -1) bytes.write(buffer, 0, read);
                            action.put("imageData", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                        }
                    }
                }
                return action.toString();
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public void acknowledgeAction(String actionId) {
            SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
            String pendingId = preferences.getString(PREF_OVERLAY_PENDING_ID, "");
            if (actionId == null || !actionId.equals(pendingId)) return;
            deletePendingCapture(preferences.getString(PREF_OVERLAY_PENDING_FILE, ""));
            preferences.edit().remove(PREF_OVERLAY_PENDING_ID).remove(PREF_OVERLAY_PENDING_MODE)
                    .remove(PREF_OVERLAY_PENDING_MESSAGE).remove(PREF_OVERLAY_PENDING_FILE).apply();
        }

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

    private void setServiceState(boolean active, boolean captureActive) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putBoolean(FloatingJournalPlugin.PREF_SERVICE_ACTIVE, active)
                .putBoolean(FloatingJournalPlugin.PREF_CAPTURE_ACTIVE, captureActive)
                .apply();
    }

    private void addOverlayIfNeeded() {
        if (windowManager == null || overlayRoot != null || !canDrawOverlays()) return;
        overlayRoot = new LinearLayout(this);
        overlayRoot.setOrientation(LinearLayout.VERTICAL);
        overlayRoot.setGravity(Gravity.END);
        int padding = dp(7);
        overlayRoot.setPadding(padding, padding, padding, padding);

        menuPanel = new LinearLayout(this);
        menuPanel.setOrientation(LinearLayout.VERTICAL);
        menuPanel.setPadding(dp(12), dp(10), dp(12), dp(12));
        menuPanel.setBackground(background(Color.WHITE, dp(18), 0x22000000));
        menuPanel.setElevation(dp(8));
        menuPanel.setVisibility(View.GONE);
        TextView title = new TextView(this);
        title.setText("星会计 · 悬浮记账");
        title.setTextColor(0xFF24334B);
        title.setTextSize(14);
        title.getPaint().setFakeBoldText(true);
        title.setPadding(dp(3), dp(2), dp(2), dp(8));
        menuPanel.addView(title);
        menuPanel.addView(actionButton("识别当前屏幕", 0xFFEAF2FF, 0xFF2367C9, v -> sendServiceAction(ACTION_CAPTURE_SCREEN)));
        menuPanel.addView(actionButton("上传图片识别", 0xFFEAF7F2, 0xFF168765, v -> sendServiceAction(ACTION_UPLOAD_IMAGE)));
        menuPanel.addView(actionButton("手动记账", 0xFFF1F4F8, 0xFF34445B, v -> sendServiceAction(ACTION_OPEN_MANUAL)));
        TextView hint = new TextView(this);
        hint.setText("识别后可修改并手动保存");
        hint.setTextColor(0xFF758195);
        hint.setTextSize(11);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, dp(7), 0, 0);
        menuPanel.addView(hint);
        overlayRoot.addView(menuPanel, new LinearLayout.LayoutParams(dp(205), LinearLayout.LayoutParams.WRAP_CONTENT));

        bubble = new TextView(this);
        bubble.setText("记");
        bubble.setTextColor(Color.WHITE);
        bubble.setTextSize(18);
        bubble.getPaint().setFakeBoldText(true);
        bubble.setGravity(Gravity.CENTER);
        bubble.setElevation(dp(9));
        bubble.setBackground(background(0xFF3178DC, dp(28), 0x00000000));
        LinearLayout.LayoutParams bubbleParams = new LinearLayout.LayoutParams(dp(54), dp(54));
        bubbleParams.topMargin = dp(8);
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
            menuPanel = null;
            bubble = null;
        }
    }

    private View actionButton(String label, int fill, int textColor, View.OnClickListener listener) {
        TextView button = new TextView(this);
        button.setText(label);
        button.setTextColor(textColor);
        button.setTextSize(14);
        button.setGravity(Gravity.CENTER);
        button.setBackground(background(fill, dp(12), 0x00000000));
        button.setPadding(dp(8), dp(12), dp(8), dp(12));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(4);
        button.setLayoutParams(params);
        button.setOnClickListener(listener);
        return button;
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
                if (!dragged && menuPanel != null) {
                    menuPanel.setVisibility(menuPanel.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE);
                }
                return true;
            default:
                return false;
        }
    }

    private void sendServiceAction(String action) {
        menuPanel.setVisibility(View.GONE);
        Intent intent = new Intent(this, FloatingJournalService.class).setAction(action);
        startService(intent);
    }

    private void setOverlayVisible(boolean visible) {
        mainHandler.post(() -> {
            if (overlayRoot != null) overlayRoot.setVisibility(visible && !journalOverlayAttached ? View.VISIBLE : View.GONE);
        });
    }

    private void removeOverlay() {
        if (windowManager != null && overlayRoot != null) {
            try { windowManager.removeView(overlayRoot); } catch (RuntimeException ignored) { }
        }
        overlayRoot = null;
        menuPanel = null;
        bubble = null;
    }

    private void stopEverything() {
        removeOverlay();
        removeJournalOverlay();
        clearOverlayPendingAction();
        stopProjection();
        setServiceState(false, false);
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
