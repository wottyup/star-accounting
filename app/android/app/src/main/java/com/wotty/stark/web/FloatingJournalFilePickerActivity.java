package com.wotty.stark.web;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebChromeClient;

/** Returns a user-selected image to the floating WebView without opening the main app page. */
public final class FloatingJournalFilePickerActivity extends Activity {
    public static final String EXTRA_CHOOSER_INTENT = "floatingJournalChooserIntent";
    private static final int REQUEST_PICK_IMAGE = 7410;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent picker = readPickerIntent();
        if (picker == null) {
            FloatingJournalService.deliverFileSelection(null);
            finish();
            return;
        }
        try {
            startActivityForResult(picker, REQUEST_PICK_IMAGE);
        } catch (ActivityNotFoundException error) {
            FloatingJournalService.deliverFileSelection(null);
            finish();
        }
    }

    @SuppressWarnings("deprecation")
    private Intent readPickerIntent() {
        if (Build.VERSION.SDK_INT >= 33) {
            return getIntent().getParcelableExtra(EXTRA_CHOOSER_INTENT, Intent.class);
        }
        return getIntent().getParcelableExtra(EXTRA_CHOOSER_INTENT);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_PICK_IMAGE) return;
        Uri[] selected = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        FloatingJournalService.deliverFileSelection(selected);
        finish();
    }
}
