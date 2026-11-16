package com.wotty.stark.web;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;

import org.json.JSONObject;

import java.util.Collections;

/** Shared system picker/trash UI. Never permanently deletes an original image. */
public final class ScreenshotSourceActivity extends Activity {
    static final String RESULT = "screenshotResult";
    private static final int PICK = 7510, TRASH = 7511;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) return;
        try {
            if ("pick".equals(getIntent().getStringExtra("operation"))) {
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*")
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/png", "image/jpeg", "image/webp"})
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                startActivityForResult(picker, PICK);
            } else if ("trash".equals(getIntent().getStringExtra("operation"))) {
                trashSelected();
            } else {
                complete("unavailable");
            }
        } catch (Exception error) { complete("unavailable"); }
    }

    private void trashSelected() throws Exception {
        // Older Android versions and document-only providers have no common
        // reversible trash API. Keep the original instead of deleting it.
        if (Build.VERSION.SDK_INT < 30) { complete("unavailable"); return; }
        Uri original = Uri.parse(ScreenshotSources.get(this, getIntent().getStringExtra("sourceId")).getString("uri"));
        Uri media = null;
        if ("media".equals(original.getAuthority())) media = original;
        else {
            try { media = MediaStore.getMediaUri(this, original); } catch (RuntimeException ignored) { }
        }
        if (media == null) { complete("unavailable"); return; }
        startIntentSenderForResult(MediaStore.createTrashRequest(getContentResolver(),
                Collections.singletonList(media), true).getIntentSender(), TRASH, null, 0, 0, 0);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK && request != TRASH) return;
        if (result != RESULT_OK) { complete("cancelled"); return; }
        try {
            if (request == PICK) {
                if (data == null || data.getData() == null) { complete("cancelled"); return; }
                complete(ScreenshotSources.remember(this, data.getData(), data.getFlags()).put("status", "selected"));
            } else complete("trashed");
        } catch (Exception error) { complete("unavailable"); }
    }

    private void complete(String status) {
        JSONObject result = new JSONObject();
        try { result.put("status", status); } catch (Exception ignored) { }
        complete(result);
    }

    private void complete(JSONObject result) {
        if ("trashed".equals(result.optString("status"))) {
            ScreenshotSources.forget(this, getIntent().getStringExtra("sourceId"));
        }
        if (getIntent().getBooleanExtra("floating", false)) {
            FloatingJournalService.deliverScreenshotResult(getIntent().getStringExtra("requestId"), result);
        } else setResult(RESULT_OK, new Intent().putExtra(RESULT, result.toString()));
        finish();
    }
}
