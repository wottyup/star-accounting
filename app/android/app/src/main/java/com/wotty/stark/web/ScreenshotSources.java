package com.wotty.stark.web;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.WebResourceResponse;

import org.json.JSONObject;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.UUID;

/** Only opaque handles for images explicitly selected by the user; never accepts a path from JS. */
final class ScreenshotSources {
    static final String PATH = "/__stark_screenshot/";
    static final long MAX_BYTES = 10 * 1024 * 1024;

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("screenshot_sources", Context.MODE_PRIVATE);
    }

    static JSONObject get(Context context, String id) throws Exception {
        if (id == null || !id.matches("[a-f0-9-]{36}")) throw new IOException("Screenshot unavailable");
        String entry = preferences(context).getString(id, null);
        if (entry == null) throw new IOException("Screenshot unavailable");
        return new JSONObject(entry);
    }

    static JSONObject remember(Context context, Uri uri, int flags) throws Exception {
        if (uri == null || !"content".equals(uri.getScheme())) throw new IOException("Unsupported image source");
        String mime = context.getContentResolver().getType(uri);
        if (!"image/png".equals(mime) && !"image/jpeg".equals(mime) && !"image/webp".equals(mime)) {
            throw new IOException("Unsupported image format");
        }
        String name = "screenshot";
        try (Cursor cursor = context.getContentResolver().query(uri,
                new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                if (!cursor.isNull(0)) name = cursor.getString(0);
                if (!cursor.isNull(1) && cursor.getLong(1) > MAX_BYTES) throw new IOException("Image exceeds 10 MiB");
            }
        }
        if ((flags & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0) {
            try { context.getContentResolver().takePersistableUriPermission(uri,
                    flags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
            } catch (SecurityException ignored) { }
        }
        String id = UUID.randomUUID().toString();
        JSONObject stored = new JSONObject().put("uri", uri.toString()).put("name", name).put("mimeType", mime);
        preferences(context).edit().putString(id, stored.toString()).apply();
        return new JSONObject().put("id", id).put("name", name).put("mimeType", mime).put("url", PATH + id);
    }

    static void forget(Context context, String id) {
        try {
            Uri uri = Uri.parse(get(context, id).getString("uri"));
            preferences(context).edit().remove(id).apply();
            // Another draft may have selected the same image independently.
            for (Object value : preferences(context).getAll().values()) {
                if (value instanceof String && uri.toString().equals(new JSONObject((String) value).optString("uri"))) return;
            }
            try { context.getContentResolver().releasePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException ignored) { }
        } catch (Exception ignored) { }
    }

    static WebResourceResponse response(Context context, Uri url) {
        if (url.getPath() == null || !url.getPath().startsWith(PATH)) return null;
        try {
            JSONObject source = get(context, url.getPath().substring(PATH.length()));
            InputStream stream = context.getContentResolver().openInputStream(Uri.parse(source.getString("uri")));
            if (stream == null) throw new IOException("Screenshot unavailable");
            InputStream limited = new FilterInputStream(stream) {
                long remaining = MAX_BYTES + 1;
                @Override public int read() throws IOException {
                    if (remaining-- <= 0) throw new IOException("Image exceeds 10 MiB");
                    return super.read();
                }
                @Override public int read(byte[] buffer, int offset, int count) throws IOException {
                    if (remaining <= 0) throw new IOException("Image exceeds 10 MiB");
                    int read = in.read(buffer, offset, (int) Math.min(count, remaining));
                    if (read > 0) remaining -= read;
                    return read;
                }
            };
            return new WebResourceResponse(source.getString("mimeType"), null, 200, "OK",
                    Collections.singletonMap("Cache-Control", "no-store"), limited);
        } catch (Exception error) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    Collections.singletonMap("Cache-Control", "no-store"), new java.io.ByteArrayInputStream(new byte[0]));
        }
    }
}
