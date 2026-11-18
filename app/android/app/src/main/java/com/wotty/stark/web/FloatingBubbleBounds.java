package com.wotty.stark.web;

/** Valid top-left positions for a bubble inside the display's safe area. */
final class FloatingBubbleBounds {
    final int minX;
    final int minY;
    final int maxX;
    final int maxY;

    FloatingBubbleBounds(int left, int top, int right, int bottom, int width, int height) {
        minX = left;
        minY = top;
        maxX = Math.max(left, right - width);
        maxY = Math.max(top, bottom - height);
    }

    int clampX(int x) {
        return Math.max(minX, Math.min(maxX, x));
    }

    int clampY(int y) {
        return Math.max(minY, Math.min(maxY, y));
    }

    int edgeX(boolean right) {
        return right ? maxX : minX;
    }

    int nearestEdgeX(int x) {
        int clamped = clampX(x);
        return (long) clamped - minX < (long) maxX - clamped ? minX : maxX;
    }
}
