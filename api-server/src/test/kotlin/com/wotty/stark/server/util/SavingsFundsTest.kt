package com.wotty.stark.server.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SavingsFundsTest {
    private val plans = listOf(SavingsFundPlan("p1", "2026-09", 200000), SavingsFundPlan("p2", "2026-10", 150000))
    private fun input(id: String, cents: Long, withdrawal: String? = null) = SavingsFundInput(id, if (withdrawal == null) "WITHDRAWAL" else "REPLENISHMENT", cents, "2026-11-14T12:00", "test", withdrawal)
    private fun append(entries: List<SavingsFundEntry>, value: SavingsFundInput, gross: Long = 350000) = appendSavingsFundEntry(entries, gross, plans, value, "2026-11-14 12:00:00")

    @Test fun partialReplenishmentsRestoreOriginalMonth() {
        var entries = append(emptyList(), input("w", 100000))
        assertEquals(100000L, savingsOutstandingCents(entries))
        assertEquals(100000L, savingsSourceUsedCents(entries, "p1"))
        assertEquals(0L, savingsSourceUsedCents(entries, "p2"))
        entries = append(entries, input("r1", 40000, "w"))
        assertEquals(60000L, savingsOutstandingCents(entries))
        entries = append(entries, input("r2", 60000, "w"))
        assertEquals(0L, savingsOutstandingCents(entries))
        assertEquals(0L, savingsSourceUsedCents(entries, "p1"))
        assertEquals(entries, decodeSavingsFundEntries(encodeSavingsFundEntries(entries)))
    }
    @Test fun legacySourcesAndCrossPlanRepaymentAreExact() {
        val entries = append(emptyList(), input("w", 270000), 400000)
        assertEquals(listOf(null, "p1", "p2"), entries.single().allocations.map { it.planId })
        assertEquals(listOf(50000L, 200000L, 20000L), entries.single().allocations.map { it.cents })
        val restored = append(entries, input("r", 70000, "w"), 400000)
        assertEquals(180000L, savingsSourceUsedCents(restored, "p1"))
        assertEquals(0L, savingsSourceUsedCents(restored, null))
    }
    @Test fun retryIsIdempotentAndLimitsReject() {
        val request = input("w", 100000)
        val entries = append(emptyList(), request)
        assertEquals(entries, append(entries, request))
        assertFailsWith<IllegalArgumentException> { append(entries, request.copy(amountCents = 100001)) }
        assertFailsWith<IllegalArgumentException> { append(emptyList(), input("x", 350001)) }
        assertFailsWith<IllegalArgumentException> { append(entries, input("r", 100001, "w")) }
        assertFailsWith<IllegalArgumentException> { append(entries, input("r", 1, "missing")) }
        assertFailsWith<IllegalArgumentException> { append(entries, request.copy(id = "bad", date = "2026-02-31T12:00")) }
    }
    @Test fun centPrecisionAndStaleGoalBasisStayCompatible() {
        val tiny = listOf(SavingsFundPlan("p", "2026-11", 30))
        val entries = appendSavingsFundEntry(emptyList(), 0, tiny, input("w", 29), "now")
        assertEquals(29L, savingsSourceUsedCents(entries, "p"))
        val restored = appendSavingsFundEntry(entries, 0, tiny, input("r", 7, "w"), "now")
        assertEquals(22L, savingsOutstandingCents(restored))
    }
}
