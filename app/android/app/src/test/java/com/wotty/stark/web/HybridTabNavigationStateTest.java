package com.wotty.stark.web;

import static org.junit.Assert.*;
import org.junit.Test;

public class HybridTabNavigationStateTest {
    @Test
    public void anAddressChangeWithoutACommitCannotCancelRecovery() {
        HybridTabNavigationState state = new HybridTabNavigationState();
        state.commit("/app/", 0);
        int request = state.select("/app/savings");
        // A WebView address may already say /app/savings. Only the page's
        // explicit commit is allowed to cancel this pending request.
        assertEquals("/app", state.getCommittedPath());
        assertEquals("/app/savings", state.getPendingPath());
        assertTrue(state.beginRecovery(request));
        assertFalse(state.beginRecovery(request));
    }

    @Test
    public void aRenderedTargetCompletesTheMatchingRequest() {
        HybridTabNavigationState state = new HybridTabNavigationState();
        int request = state.select("/app/savings");
        assertTrue(state.commit("/app/savings/", request));
        assertNull(state.getPendingPath());
        assertFalse(state.beginRecovery(request));
        assertEquals(0, state.select("/app/savings/"));
    }

    @Test
    public void repeatedTapsKeepTheOriginalRequestAndRecoveryDeadline() {
        HybridTabNavigationState state = new HybridTabNavigationState();
        int request = state.select("/app/savings");
        assertEquals(request, state.select("/app/savings/"));
        assertTrue(state.beginRecovery(request));
        assertEquals(request, state.select("/app/savings"));
        assertFalse(state.beginRecovery(request));
    }

    @Test
    public void anOlderRequestCannotConfirmOrOverrideTheLatestSelection() {
        HybridTabNavigationState state = new HybridTabNavigationState();
        state.commit("/app", 0);
        int first = state.select("/app/savings");
        int latest = state.select("/app/accounts");
        assertFalse(state.commit("/app/savings", first));
        assertEquals("/app", state.getCommittedPath());
        assertFalse(state.beginRecovery(first));
        assertTrue(state.commit("/app/accounts", latest));
        assertFalse(state.commit("/app/savings", first));
        assertEquals("/app/accounts", state.getCommittedPath());
    }

    @Test
    public void anUncorrelatedCommitKeepsTheDeadlineUntilAFreshDocumentArrives() {
        HybridTabNavigationState state = new HybridTabNavigationState();
        int request = state.select("/app/assets");
        assertFalse(state.commit("/app/assets", 0));
        assertEquals(request, state.getPendingRequestId());
        assertTrue(state.beginRecovery(request));
        // A reloaded document has no copy of the original JS request id.
        assertFalse(state.commit("/app", 0));
        assertTrue(state.commit("/app/assets/", 0));
        assertNull(state.getPendingPath());
    }

    @Test
    public void tappingTheRenderedTabCanSupersedeAPendingDifferentTab() {
        HybridTabNavigationState state = new HybridTabNavigationState();
        state.commit("/app", 0);
        int first = state.select("/app/savings");
        int cancel = state.select("/app");
        assertNotEquals(first, cancel);
        assertFalse(state.commit("/app/savings", first));
        assertTrue(state.beginRecovery(cancel));
        assertTrue(state.commit("/app", 0));
    }
}
