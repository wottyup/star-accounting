package com.wotty.stark.web;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;

@CapacitorPlugin(name = "BillExport")
public class BillExportPlugin extends Plugin {
    private static final long MAX_EXPORT_BYTES = 100L * 1024 * 1024;
    private static final int MAX_CHUNK_BYTES = 24 * 1024;
    private static final String DOWNLOAD_FOLDER = Environment.DIRECTORY_DOWNLOADS + "/星会计/";

    private final Object sessionLock = new Object();
    private boolean busy;
    private String sessionId;
    private String fileName;
    private Uri fileUri;
    private OutputStream output;
    private long expectedBytes;
    private long writtenBytes;
    private boolean mediaStoreFile;

    @PluginMethod
    public void begin(PluginCall call) {
        String name = call.getString("fileName");
        // JSON byte counts within the 100 MiB limit are Integers, not Longs.
        Integer size = call.getInt("totalBytes");
        if (name == null || !name.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,100}\\.csv")
                || size == null || size <= 0 || size > MAX_EXPORT_BYTES) {
            call.reject("导出文件名或文件大小无效。");
            return;
        }
        synchronized (sessionLock) {
            if (busy) {
                call.reject("已有账单正在导出，请稍后重试。");
                return;
            }
            busy = true;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            picker.addCategory(Intent.CATEGORY_OPENABLE);
            picker.setType("text/csv");
            picker.putExtra(Intent.EXTRA_TITLE, name);
            try {
                startActivityForResult(call, picker, "onDocumentCreated");
            } catch (Exception error) {
                synchronized (sessionLock) { busy = false; }
                call.reject("无法打开系统文件保存界面。");
            }
            return;
        }

        bridge.execute(() -> {
            Uri uri = null;
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "text/csv");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, DOWNLOAD_FOLDER);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                ContentResolver resolver = getContext().getContentResolver();
                uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("无法创建下载文件");
                openSession(call, uri, name, size, true);
            } catch (Exception error) {
                if (uri != null) deleteQuietly(uri);
                synchronized (sessionLock) { resetSession(); }
                call.reject("无法在下载目录创建账单文件，请检查设备存储空间。");
            }
        });
    }

    @ActivityCallback
    private void onDocumentCreated(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            synchronized (sessionLock) { busy = false; }
            call.reject("已取消保存");
            return;
        }
        bridge.execute(() -> {
            try {
                openSession(call, uri, call.getString("fileName"), call.getInt("totalBytes"), false);
            } catch (Exception error) {
                deleteQuietly(uri);
                synchronized (sessionLock) { resetSession(); }
                call.reject("无法写入选择的文件，请重新选择保存位置。");
            }
        });
    }

    private void openSession(PluginCall call, Uri uri, String name, long size, boolean inMediaStore) throws IOException {
        OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "w");
        if (stream == null) throw new IOException("无法打开导出文件");
        synchronized (sessionLock) {
            sessionId = UUID.randomUUID().toString();
            fileName = name;
            fileUri = uri;
            output = stream;
            expectedBytes = size;
            writtenBytes = 0;
            mediaStoreFile = inMediaStore;
            call.resolve(new JSObject().put("id", sessionId));
        }
    }

    @PluginMethod
    public void append(PluginCall call) {
        String id = call.getString("id");
        String data = call.getString("data");
        if (id == null || data == null) {
            call.reject("账单数据不完整，请重新导出。");
            return;
        }
        bridge.execute(() -> {
            synchronized (sessionLock) {
                if (output == null || !id.equals(sessionId)) {
                    call.reject("导出任务已失效，请重新导出。");
                    return;
                }
                try {
                    byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                    if (bytes.length == 0 || bytes.length > MAX_CHUNK_BYTES
                            || writtenBytes + bytes.length > expectedBytes) {
                        throw new IOException("账单数据长度无效");
                    }
                    output.write(bytes);
                    writtenBytes += bytes.length;
                    call.resolve();
                } catch (Exception error) {
                    discardSession();
                    call.reject("账单写入失败，请检查设备存储空间后重试。");
                }
            }
        });
    }

    @PluginMethod
    public void finish(PluginCall call) {
        String id = call.getString("id");
        bridge.execute(() -> {
            synchronized (sessionLock) {
                if (output == null || id == null || !id.equals(sessionId)) {
                    call.reject("导出任务已失效，请重新导出。");
                    return;
                }
                try {
                    if (writtenBytes != expectedBytes) throw new IOException("账单数据未写完");
                    output.flush();
                    output.close();
                    output = null;
                    if (mediaStoreFile) {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                        if (getContext().getContentResolver().update(fileUri, values, null, null) <= 0) {
                            throw new IOException("无法完成下载文件");
                        }
                    }
                    String savedName = readDisplayName(fileUri, fileName);
                    String location = mediaStoreFile ? DOWNLOAD_FOLDER + savedName : "所选位置/" + savedName;
                    resetSession();
                    call.resolve(new JSObject().put("location", location));
                } catch (Exception error) {
                    discardSession();
                    call.reject("账单保存失败，请检查设备存储空间后重试。");
                }
            }
        });
    }

    @PluginMethod
    public void abort(PluginCall call) {
        String id = call.getString("id");
        bridge.execute(() -> {
            synchronized (sessionLock) {
                if (id != null && id.equals(sessionId)) discardSession();
                call.resolve();
            }
        });
    }

    private String readDisplayName(Uri uri, String fallback) {
        try (Cursor cursor = getContext().getContentResolver().query(
                uri, new String[]{MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (Exception ignored) {
            // The requested name is still useful if a document provider does not expose it.
        }
        return fallback;
    }

    private void deleteQuietly(Uri uri) {
        try { getContext().getContentResolver().delete(uri, null, null); }
        catch (Exception ignored) { }
    }

    private void discardSession() {
        try { if (output != null) output.close(); }
        catch (IOException ignored) { }
        if (fileUri != null) deleteQuietly(fileUri);
        resetSession();
    }

    private void resetSession() {
        busy = false;
        sessionId = null;
        fileName = null;
        fileUri = null;
        output = null;
        expectedBytes = 0;
        writtenBytes = 0;
        mediaStoreFile = false;
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (sessionLock) { discardSession(); }
    }
}
