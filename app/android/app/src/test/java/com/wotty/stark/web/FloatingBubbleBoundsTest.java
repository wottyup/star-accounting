package com.wotty.stark.web;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class FloatingBubbleBoundsTest {
    @Test
    public void draggingStaysInsideAllFourEdges() {
        FloatingBubbleBounds bounds = new FloatingBubbleBounds(0, 0, 1080, 2200, 144, 144);
        assertEquals(0, bounds.clampX(-200));
        assertEquals(936, bounds.clampX(5000));
        assertEquals(0, bounds.clampY(-200));
        assertEquals(2056, bounds.clampY(5000));
        assertEquals(300, bounds.clampX(300));
        assertEquals(600, bounds.clampY(600));
    }

    @Test
    public void releaseChoosesTheNearestSideIncludingAfterDraggingBeyondTheScreen() {
        FloatingBubbleBounds bounds = new FloatingBubbleBounds(0, 0, 1080, 2200, 144, 144);
        assertEquals(0, bounds.nearestEdgeX(-1000));
        assertEquals(0, bounds.nearestEdgeX(467));
        assertEquals(936, bounds.nearestEdgeX(468));
        assertEquals(936, bounds.nearestEdgeX(5000));
    }

    @Test
    public void safeAreaAndActualBubbleSizeKeepTheEntireButtonVisible() {
        FloatingBubbleBounds bounds = new FloatingBubbleBounds(72, 96, 2328, 1008, 144, 144);
        assertEquals(72, bounds.nearestEdgeX(100));
        assertEquals(2184, bounds.nearestEdgeX(2200));
        assertEquals(96, bounds.clampY(0));
        assertEquals(864, bounds.clampY(2000));
        assertTrue(bounds.maxX + 144 <= 2328);
        assertTrue(bounds.maxY + 144 <= 1008);
    }

    @Test
    public void rotatingPreservesTheDockedSideInsteadOfReusingTheOldHorizontalCoordinate() {
        FloatingBubbleBounds portrait = new FloatingBubbleBounds(0, 0, 1080, 2200, 144, 144);
        FloatingBubbleBounds landscape = new FloatingBubbleBounds(0, 0, 2200, 1080, 144, 144);
        // The old right-edge x would incorrectly be nearer the left after rotation.
        assertEquals(0, landscape.nearestEdgeX(portrait.edgeX(true)));
        assertEquals(2056, landscape.edgeX(true));
        assertEquals(0, landscape.edgeX(false));
        assertEquals(936, landscape.clampY(portrait.maxY));
    }

    @Test
    public void resizingAndDensityChangesUseTheNewButtonSize() {
        FloatingBubbleBounds bounds = new FloatingBubbleBounds(0, 0, 720, 1280, 192, 192);
        assertEquals(528, bounds.edgeX(true));
        assertEquals(1088, bounds.clampY(2000));
    }

    @Test
    public void tinyOrTemporarilyEmptyFramesNeverProduceNegativeCoordinates() {
        FloatingBubbleBounds small = new FloatingBubbleBounds(0, 0, 48, 48, 48, 48);
        FloatingBubbleBounds empty = new FloatingBubbleBounds(0, 0, 0, 0, 48, 48);
        assertEquals(0, small.edgeX(true));
        assertEquals(0, small.clampY(500));
        assertEquals(0, empty.edgeX(true));
        assertEquals(0, empty.clampY(500));
    }

    @Test
    public void draggingAcrossTheCenterSwitchesDockingEdges() {
        FloatingBubbleBounds bounds = new FloatingBubbleBounds(0, 0, 1080, 2200, 144, 144);
        int x = bounds.edgeX(true);
        x = bounds.clampX(x - 600);
        assertEquals(0, bounds.nearestEdgeX(x));
        x = bounds.clampX(bounds.edgeX(false) + 700);
        assertEquals(936, bounds.nearestEdgeX(x));
    }
}
