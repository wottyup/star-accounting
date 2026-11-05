package com.wotty.stark.web;

import android.app.DownloadManager;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.SystemClock;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

import org.json.JSONException;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private static final long MAX_APK_BYTES = 500L * 1024 * 1024;
    private static final String PROGRESS_EVENT = "downloadProgress";
    private static final long DOWNLOAD_POLL_INTERVAL_MS = 250;
    private static final long DOWNLOAD_STALL_TIMEOUT_MS = 120_000;
    private static final long DOWNLOAD_TOTAL_TIMEOUT_MS = 15 * 60_000;
    private static final int CANNOT_RESUME_RETRIES = 1;

    private static final class CannotResumeDownloadException extends IOException {
        CannotResumeDownloadException() {
            super("下载连接已中断且无法续传，请重新下载。");
        }
    }

    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private volatile File downloadedFile;
    private volatile String downloadedUrl;
    private volatile String approvedLanOrigin;

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        try {
            PackageInfo installed = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionCode", versionCode(installed));
            result.put("versionName", installed.versionName);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取当前安装版本，请稍后重试。");
        }
    }

    @PluginMethod
    public void getLanUpdateManifest(PluginCall call) {
        String source = call.getString("url");
        final URL manifestUrl;
        try {
            manifestUrl = requirePrivateHttp(new URL(source == null ? "" : source));
        } catch (Exception error) {
            call.reject("请输入有效的局域网版本接口地址。");
            return;
        }

        bridge.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) manifestUrl.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(10_000);
                connection.setReadTimeout(15_000);
                connection.setRequestProperty("Accept", "application/json");
                if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                    throw new IOException("局域网版本接口返回 HTTP " + connection.getResponseCode() + "。");
                }
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                try (InputStream input = connection.getInputStream()) {
                    byte[] chunk = new byte[8192];
                    int count;
                    while ((count = input.read(chunk)) != -1) {
                        if (buffer.size() + count > 64 * 1024) throw new IOException("版本信息过大。");
                        buffer.write(chunk, 0, count);
                    }
                }
                JSObject manifest = new JSObject(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
                Integer versionCode = manifest.getInteger("versionCode");
                String versionName = manifest.getString("versionName");
                String apkSource = manifest.getString("apkUrl");
                if (versionCode == null || versionCode <= 0 || versionName == null || versionName.isEmpty() ||
                        apkSource == null || apkSource.isEmpty()) {
                    throw new IOException("局域网版本信息缺少版本号或安装包地址。");
                }
                URL apkUrl = requirePrivateHttp(new URL(apkSource));
                if (!lanOrigin(manifestUrl).equals(lanOrigin(apkUrl))) {
                    throw new IOException("安装包须与局域网版本接口位于同一地址和端口。");
                }
                approvedLanOrigin = lanOrigin(manifestUrl);
                call.resolve(manifest);
            } catch (JSONException error) {
                call.reject("局域网版本信息不是有效 JSON。");
            } catch (IOException error) {
                call.reject(error.getMessage() == null ? "无法连接局域网版本接口。" : error.getMessage());
            } catch (Exception error) {
                call.reject("无法连接局域网版本接口，请检查手机网络和地址。");
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String source = call.getString("url");
        Integer expectedVersionCode = call.getInt("versionCode");
        if (source == null || expectedVersionCode == null || expectedVersionCode <= 0) {
            call.reject("更新地址或版本信息无效，请重新检查更新。");
            return;
        }

        try {
            requireUpdateUrl(new URL(source));
            PackageInfo installed = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
            if (expectedVersionCode <= versionCode(installed)) {
                call.reject("当前已是此版本或更新版本，无需重复下载。");
                return;
            }
        } catch (Exception ignored) {
            call.reject("更新地址或当前安装版本无效，请重新检查更新。");
            return;
        }

        if (!downloading.compareAndSet(false, true)) {
            call.reject("安装包正在下载，请稍候。");
            return;
        }

        bridge.execute(() -> {
            try {
                File apk = downloadedFile;
                if (!source.equals(downloadedUrl) || apk == null || !apk.isFile() ||
                        !isValidApk(apk, expectedVersionCode)) {
                    downloadedFile = null;
                    downloadedUrl = null;
                    apk = downloadApk(source, expectedVersionCode);
                    if (!isValidApk(apk, expectedVersionCode)) {
                        apk.delete();
                        throw new IOException("安装包与当前星会计版本不匹配，请重新检查更新。");
                    }
                    downloadedFile = apk;
                    downloadedUrl = source;
                }

                File installFile = apk;
                getActivity().runOnUiThread(() -> {
                    downloading.set(false);
                    openInstaller(call, installFile);
                });
            } catch (IOException error) {
                downloading.set(false);
                call.reject(error.getMessage() == null ? "下载失败，请稍后重试。" : error.getMessage());
            } catch (Exception error) {
                downloading.set(false);
                call.reject("下载失败，请检查网络后重试。");
            }
        });
    }

    @PluginMethod
    public void openDownloadInBrowser(PluginCall call) {
        String source = call.getString("url");
        try {
            requireUpdateUrl(new URL(source == null ? "" : source));
            Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(source));
            browser.addCategory(Intent.CATEGORY_BROWSABLE);
            getActivity().startActivity(browser);
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception ignored) {
            call.reject("无法打开浏览器，请从关于页面进入项目网站下载更新。");
        }
    }

    private File downloadApk(String source, int expectedVersionCode) throws IOException {
        File externalDownloads = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (externalDownloads == null) {
            throw new IOException("无法访问系统下载目录，请检查存储空间后重试。");
        }
        File directory = new File(externalDownloads, "app-updates");
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("无法创建安装包缓存目录。");
        }
        File target = new File(directory, "star-accounting-update-" + expectedVersionCode + ".apk");
        if (target.isFile() && isValidApk(target, expectedVersionCode)) {
            reportProgress("downloading", target.length(), target.length(), 0);
            return target;
        }
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) throw new IOException("系统下载服务不可用，请点击下方“下载更新”改用浏览器下载。");

        for (int attempt = 0; attempt <= CANNOT_RESUME_RETRIES; attempt++) {
            if (target.exists() && !target.delete()) throw new IOException("无法清理上次未完成的下载。");
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(source));
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            request.setTitle("星会计更新");
            request.setDescription("正在下载安装包");
            request.addRequestHeader("Accept", "application/vnd.android.package-archive, application/octet-stream");
            request.setDestinationUri(Uri.fromFile(target));

            final long downloadId;
            try {
                downloadId = manager.enqueue(request);
            } catch (Exception error) {
                throw new IOException("无法启动系统下载，请点击下方“下载更新”改用浏览器下载。", error);
            }
            try {
                return awaitSystemDownload(manager, downloadId, target);
            } catch (CannotResumeDownloadException error) {
                if (attempt == CANNOT_RESUME_RETRIES) throw error;
            }
        }
        throw new IOException("下载失败，请稍后重试。");
    }

    private File awaitSystemDownload(DownloadManager manager, long downloadId, File target) throws IOException {
        long startedAt = SystemClock.elapsedRealtime();
        long lastProgressAt = startedAt;
        long lastReportAt = startedAt;
        long lastReportedBytes = 0;
        long previousBytes = -1;
        reportProgress("downloading", 0, 0, 0);

        while (true) {
            long received;
            long total;
            int status;
            int reason;
            try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId))) {
                if (cursor == null || !cursor.moveToFirst()) {
                    cancelSystemDownload(manager, downloadId, target);
                    throw new IOException("系统下载任务已丢失，请重新下载。");
                }
                status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                received = Math.max(0, cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)));
                total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            }

            if (received > MAX_APK_BYTES || total > MAX_APK_BYTES) {
                cancelSystemDownload(manager, downloadId, target);
                throw new IOException("安装包过大，已停止下载。");
            }

            long now = SystemClock.elapsedRealtime();
            if (received != previousBytes) {
                previousBytes = received;
                lastProgressAt = now;
            }
            if (now - lastReportAt >= DOWNLOAD_POLL_INTERVAL_MS || status == DownloadManager.STATUS_SUCCESSFUL) {
                long elapsed = Math.max(1, now - lastReportAt);
                long bytesPerSecond = Math.max(0, (received - lastReportedBytes) * 1000 / elapsed);
                reportProgress("downloading", received, total, bytesPerSecond);
                lastReportAt = now;
                lastReportedBytes = received;
            }

            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                if (!target.isFile() || target.length() == 0 || (total > 0 && target.length() != total)) {
                    cancelSystemDownload(manager, downloadId, target);
                    throw new IOException("安装包下载不完整，请重试。");
                }
                reportProgress("downloading", target.length(), target.length(), 0);
                return target;
            }
            if (status == DownloadManager.STATUS_FAILED) {
                cancelSystemDownload(manager, downloadId, target);
                throw systemDownloadError(reason);
            }
            if (now - startedAt >= DOWNLOAD_TOTAL_TIMEOUT_MS || now - lastProgressAt >= DOWNLOAD_STALL_TIMEOUT_MS) {
                cancelSystemDownload(manager, downloadId, target);
                throw new IOException("下载长时间没有进展，请点击下方“下载更新”改用浏览器下载。");
            }

            try {
                Thread.sleep(DOWNLOAD_POLL_INTERVAL_MS);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                cancelSystemDownload(manager, downloadId, target);
                throw new IOException("下载已中断，请重新下载。", error);
            }
        }
    }

    private void cancelSystemDownload(DownloadManager manager, long downloadId, File target) {
        try {
            manager.remove(downloadId);
        } catch (Exception ignored) {
            // Best-effort cleanup; the app-owned file is removed below as well.
        }
        if (target.exists()) target.delete();
    }

    private IOException systemDownloadError(int reason) {
        if (reason == DownloadManager.ERROR_INSUFFICIENT_SPACE) {
            return new IOException("手机存储空间不足，无法下载更新。");
        }
        if (reason == DownloadManager.ERROR_DEVICE_NOT_FOUND) {
            return new IOException("无法访问手机存储，请检查存储状态后重试。");
        }
        if (reason == DownloadManager.ERROR_CANNOT_RESUME) {
            return new CannotResumeDownloadException();
        }
        if (reason == DownloadManager.ERROR_HTTP_DATA_ERROR ||
                reason == DownloadManager.ERROR_UNHANDLED_HTTP_CODE) {
            return new IOException("下载服务器响应异常，请点击下方“下载更新”改用浏览器下载。");
        }
        return new IOException("系统下载失败（错误 " + reason + "），请重试或改用浏览器下载。");
    }

    private URL requireHttps(URL url) throws IOException {
        if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getHost().isEmpty() ||
                url.getUserInfo() != null) {
            throw new IOException("更新地址必须是有效的 HTTPS 链接。");
        }
        return url;
    }

    private URL requirePrivateHttp(URL url) throws IOException {
        String host = url.getHost();
        if (!"http".equalsIgnoreCase(url.getProtocol()) || !isPrivateIpv4(host) ||
                url.getUserInfo() != null || url.getRef() != null ||
                (url.getPort() != -1 && (url.getPort() < 1 || url.getPort() > 65535))) {
            throw new IOException("局域网地址须使用私有 IPv4 的 HTTP 链接。");
        }
        return url;
    }

    private URL requireUpdateUrl(URL url) throws IOException {
        if ("https".equalsIgnoreCase(url.getProtocol())) return requireHttps(url);
        requirePrivateHttp(url);
        if (!lanOrigin(url).equals(approvedLanOrigin)) {
            throw new IOException("请先从局域网版本接口检查更新。");
        }
        return url;
    }

    private String lanOrigin(URL url) {
        return url.getProtocol().toLowerCase() + "://" + url.getHost() + ":" + (url.getPort() == -1 ? 80 : url.getPort());
    }

    private boolean isPrivateIpv4(String host) {
        if (host == null) return false;
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return false;
        int[] octets = new int[4];
        for (int index = 0; index < 4; index++) {
            if (!parts[index].matches("0|[1-9][0-9]{0,2}")) return false;
            try {
                octets[index] = Integer.parseInt(parts[index]);
            } catch (NumberFormatException error) {
                return false;
            }
            if (octets[index] > 255) return false;
        }
        return octets[0] == 10 ||
                (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31) ||
                (octets[0] == 192 && octets[1] == 168);
    }

    private boolean isValidApk(File apk, int expectedVersionCode) {
        if (!apk.isFile() || apk.length() == 0 || apk.length() > MAX_APK_BYTES) return false;
        PackageInfo archive = getContext().getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (archive == null || !getContext().getPackageName().equals(archive.packageName)) return false;
        try {
            PackageInfo installed = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            return versionCode(archive) == expectedVersionCode && versionCode(archive) > versionCode(installed);
        } catch (Exception ignored) {
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    private long versionCode(PackageInfo packageInfo) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? packageInfo.getLongVersionCode() : packageInfo.versionCode;
    }

    private void openInstaller(PluginCall call, File apk) {
        if (!apk.isFile()) {
            call.reject("安装包缓存已清理，请重新下载。");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !getContext().getPackageManager().canRequestPackageInstalls()) {
            reportProgress("permission", apk.length(), apk.length(), 0);
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            try {
                startActivityForResult(call, settings, "onInstallPermissionResult");
            } catch (Exception ignored) {
                call.reject("无法打开安装权限设置，请在系统设置中允许星会计安装应用。");
            }
            return;
        }

        try {
            Uri uri = FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", apk);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.setClipData(ClipData.newUri(getContext().getContentResolver(), "星会计更新", uri));
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(install);
            call.resolve(new JSObject().put("installationStarted", true));
        } catch (Exception ignored) {
            call.reject("无法打开系统安装界面，请稍后重试。");
        }
    }

    @ActivityCallback
    private void onInstallPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("请在系统设置中允许星会计安装应用，再点击重试。");
            return;
        }
        File apk = downloadedFile;
        Integer expectedVersionCode = call.getInt("versionCode");
        if (apk == null || expectedVersionCode == null || !isValidApk(apk, expectedVersionCode)) {
            call.reject("安装包缓存已失效，请重新下载。");
            return;
        }
        openInstaller(call, apk);
    }

    private void reportProgress(String stage, long received, long total, long bytesPerSecond) {
        JSObject progress = new JSObject();
        progress.put("stage", stage);
        progress.put("downloadedBytes", received);
        progress.put("totalBytes", total > 0 ? total : 0);
        progress.put("bytesPerSecond", Math.max(0, bytesPerSecond));
        if (total > 0) progress.put("percent", Math.min(100, (int) (received * 100 / total)));
        getActivity().runOnUiThread(() -> notifyListeners(PROGRESS_EVENT, progress));
    }
}
