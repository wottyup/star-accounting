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
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/** User-started floating controls and on-demand screen capture for journal entry. */
public class FloatingJournalService extends Service {
    public static final String ACTION_ENABLE_OVERLAY = "com.wotty.stark.action.ENABLE_FLOATING_OVERLAY";
    public static final String ACTION_ENABLE_CAPTURE = "com.wotty.stark.action.ENABLE_SCREEN_CAPTURE";
    public static final String ACTION_STOP_CAPTURE = "com.wotty.stark.action.STOP_SCREEN_CAPTURE";
    public static final String ACTION_STOP = "com.wotty.stark.action.STOP_FLOATING_JOURNAL";
    private static final String ACTION_CAPTURE_SCREEN = "com.wotty.stark.action.CAPTURE_CURRENT_SCREEN";
    private static final String ACTION_UPLOAD_IMAGE = "com.wotty.stark.action.UPLOAD_JOURNAL_IMAGE";
    private static final String PREFS = "floating_journal";
    private static final String NOTIFICATION_CHANNEL = "floating-journal";
    private static final int NOTIFICATION_ID = 7321;
    private static final long CAPTURE_TIMEOUT_MS = 5_000L;
    private static volatile boolean running;

    private final AtomicBoolean captureRequested = new AtomicBoolean(false);
    private final AtomicBoolean captureInProgress = new AtomicBoolean(false);
    private final Handler mainHandler = new Handler();
    private WindowManager windowManager;
    private LinearLayout overlayRoot;
    private LinearLayout menuPanel;
    private TextView bubble;
    private WindowManager.LayoutParams overlayParams;
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
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        shuttingDown = true;
        running = false;
        removeOverlay();
        stopProjection();
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
            captureHandler = null;
        }
        setServiceState(false, false);
        stopForeground(true);
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
        String previousFile = preferences.getString(FloatingJournalPlugin.PREF_PENDING_FILE, "");
        if (previousFile != null && previousFile.matches("floating-screen-[A-Za-z0-9-]+\\.jpg")) {
            //noinspection ResultOfMethodCallIgnored
            new File(getCacheDir(), previousFile).delete();
        }
        String actionId = UUID.randomUUID().toString();
        preferences.edit()
                .putString(FloatingJournalPlugin.PREF_PENDING_ID, actionId)
                .putString(FloatingJournalPlugin.PREF_PENDING_MODE, mode)
                .putString(FloatingJournalPlugin.PREF_PENDING_MESSAGE, message == null ? "" : message)
                .putString(FloatingJournalPlugin.PREF_PENDING_FILE, fileName == null ? "" : fileName)
                .apply();
        Intent event = new Intent(FloatingJournalPlugin.ACTION_PENDING).setPackage(getPackageName());
        sendBroadcast(event);
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            try { startActivity(launch); } catch (RuntimeException ignored) { }
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
        title.setText("星会计 · 快速记账");
        title.setTextColor(0xFF24334B);
        title.setTextSize(14);
        title.setTypeface(null, Paint.FAKE_BOLD_TEXT_FLAG);
        title.setPadding(dp(3), dp(2), dp(2), dp(8));
        menuPanel.addView(title);
        menuPanel.addView(actionButton("识别当前屏幕", 0xFFEAF2FF, 0xFF2367C9, v -> sendServiceAction(ACTION_CAPTURE_SCREEN)));
        menuPanel.addView(actionButton("上传图片识别", 0xFFEAF7F2, 0xFF168765, v -> sendServiceAction(ACTION_UPLOAD_IMAGE)));
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
        bubble.setTypeface(null, Paint.FAKE_BOLD_TEXT_FLAG);
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
            if (overlayRoot != null) overlayRoot.setVisibility(visible ? View.VISIBLE : View.GONE);
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
