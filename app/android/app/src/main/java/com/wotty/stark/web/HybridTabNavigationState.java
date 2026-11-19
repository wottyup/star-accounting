package com.wotty.stark.web;

/** Tracks rendered-route acknowledgements, independently of WebView's address. */
final class HybridTabNavigationState {
    private int sequence;
    private int pendingRequestId;
    private String pendingPath;
    private String committedPath;
    private boolean recovering;

    int select(String path) {
        String target = normalize(path);
        if (target.equals(pendingPath)) return pendingRequestId;
        if (pendingPath == null && target.equals(committedPath)) return 0;
        pendingRequestId = ++sequence;
        pendingPath = target;
        recovering = false;
        return pendingRequestId;
    }

    boolean commit(String path, int requestId) {
        // A late acknowledgement from an older tap cannot confirm a newer tap
        // or replace its already-rendered selection.
        if (requestId != 0 && requestId != pendingRequestId) return false;
        committedPath = normalize(path);
        if (pendingPath == null || !pendingPath.equals(committedPath)
                || (requestId != pendingRequestId && !(recovering && requestId == 0))) return false;
        pendingPath = null;
        pendingRequestId = 0;
        recovering = false;
        return true;
    }

    boolean beginRecovery(int requestId) {
        if (pendingPath == null || requestId != pendingRequestId || recovering) return false;
        recovering = true;
        return true;
    }

    int getPendingRequestId() { return pendingRequestId; }
    String getPendingPath() { return pendingPath; }
    String getCommittedPath() { return committedPath; }

    private static String normalize(String path) {
        return path.replaceAll("/+$", "");
    }
}
