package com.wotty.stark.web;

import android.app.Activity;
import android.app.RecoverableSecurityException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.MediaStore;

import org.json.JSONObject;

import java.util.Collections;

/** Shared system picker/deletion UI for the main app and the floating WebView. */
public final class ScreenshotSourceActivity extends Activity {
    static final String RESULT = "screenshotResult";
    private static final int PICK = 7510, DELETE = 7511, AUTHORIZE_DELETE = 7512;
    private Uri retryDeleteUri;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) {
            String retry = state.getString("retryDeleteUri");
            if (retry != null) retryDeleteUri = Uri.parse(retry);
            return;
        }
        try {
            if ("pick".equals(getIntent().getStringExtra("operation"))) {
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*")
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/png", "image/jpeg", "image/webp"})
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                startActivityForResult(picker, PICK);
            } else if ("delete".equals(getIntent().getStringExtra("operation"))) {
                deleteSelected();
            } else {
                complete("unavailable");
            }
        } catch (Exception error) { complete("unavailable"); }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        if (retryDeleteUri != null) state.putString("retryDeleteUri", retryDeleteUri.toString());
        super.onSaveInstanceState(state);
    }

    private void deleteSelected() throws Exception {
        Uri original = Uri.parse(ScreenshotSources.get(this, getIntent().getStringExtra("sourceId")).getString("uri"));
        Uri media = null;
        if ("media".equals(original.getAuthority())) media = original;
        else if (Build.VERSION.SDK_INT >= 29) {
            try { media = MediaStore.getMediaUri(this, original); } catch (RuntimeException ignored) { }
        }
        if (media != null && Build.VERSION.SDK_INT >= 30) {
            startIntentSenderForResult(MediaStore.createDeleteRequest(getContentResolver(),
                    Collections.singletonList(media)).getIntentSender(), DELETE, null, 0, 0, 0);
        } else if (media != null) {
            retryDeleteUri = media;
            try { complete(getContentResolver().delete(media, null, null) > 0 ? "deleted" : "unavailable"); }
            catch (SecurityException error) {
                if (Build.VERSION.SDK_INT == 29 && error instanceof RecoverableSecurityException) {
                    startIntentSenderForResult(((RecoverableSecurityException) error).getUserAction()
                            .getActionIntent().getIntentSender(), AUTHORIZE_DELETE, null, 0, 0, 0);
                } else throw error;
            }
        } else if (DocumentsContract.isDocumentUri(this, original)) {
            complete(DocumentsContract.deleteDocument(getContentResolver(), original) ? "deleted" : "unavailable");
        } else complete("unavailable");
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK && request != DELETE && request != AUTHORIZE_DELETE) return;
        if (result != RESULT_OK) { complete("cancelled"); return; }
        try {
            if (request == PICK) {
                if (data == null || data.getData() == null) { complete("cancelled"); return; }
                complete(ScreenshotSources.remember(this, data.getData(), data.getFlags()).put("status", "selected"));
            } else if (request == AUTHORIZE_DELETE) {
                complete(retryDeleteUri != null && getContentResolver().delete(retryDeleteUri, null, null) > 0
                        ? "deleted" : "unavailable");
            } else complete("deleted");
        } catch (Exception error) { complete("unavailable"); }
    }

    private void complete(String status) {
        JSONObject result = new JSONObject();
        try { result.put("status", status); } catch (Exception ignored) { }
        complete(result);
    }

    private void complete(JSONObject result) {
        if ("deleted".equals(result.optString("status"))) {
            ScreenshotSources.forget(this, getIntent().getStringExtra("sourceId"));
        }
        if (getIntent().getBooleanExtra("floating", false)) {
            FloatingJournalService.deliverScreenshotResult(getIntent().getStringExtra("requestId"), result);
        } else setResult(RESULT_OK, new Intent().putExtra(RESULT, result.toString()));
        finish();
    }
}
