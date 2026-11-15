package com.wotty.stark.server.util

import java.io.File
import kotlinx.serialization.json.*
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class LedgerWorkbookTest {
    private fun fixture() = Json.decodeFromString<LedgerWorkbookRequest>(File("../testdata/ledger-workbook.json").readText())
    private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content

    @Test fun referencesAndRecurringChargeIdsSurvive() {
        val input = fixture()
        val (account, rows) = prepareLedgerWorkbook("signed-in-user", input)
        assertEquals("signed-in-user", rows.getValue("accounts").single().text("ownerId"))
        assertNotEquals("source-account", account)
        val goal = rows.getValue("savingsGoals").single()
        val plan = rows.getValue("savingsPlans").single()
        assertEquals(goal.text("id"), plan.text("goalId"))
        val funds = decodeSavingsFundEntries(goal.text("fundMovements"))
        assertEquals(plan.text("id"), funds.first().allocations.single().planId)
        assertEquals(15000L, savingsOutstandingCents(funds))
        val sub = rows.getValue("subscriptions").single().text("id")
        assertEquals("subscription-$sub-2026-11", rows.getValue("transactions").first().text("id"))
        assertEquals("subscription:$sub:2026-11", rows.getValue("transactions").first().text("orderId"))
        assertEquals(rows.getValue("loans").single().text("id"), rows.getValue("transactions").last().text("loanId"))
        assertEquals(account, prepareLedgerWorkbook("signed-in-user", input).first)
        assertNotEquals(account, prepareLedgerWorkbook("other-user", input).first)
        assertTrue(rows.values.flatten().none { (it["userId"] as? JsonPrimitive)?.content == "source-user" })
    }

    @Test fun missingSheetsAndBrokenReferencesReject() {
        val input = fixture()
        assertFailsWith<IllegalArgumentException> { prepareLedgerWorkbook("u", input.copy(sheets = input.sheets - "budgets")) }
        val plan = input.sheets.getValue("savingsPlans").single()
        val broken = input.sheets + ("savingsPlans" to listOf(JsonObject(plan + ("goalId" to JsonPrimitive("missing")))))
        assertFailsWith<IllegalArgumentException> { prepareLedgerWorkbook("u", input.copy(sheets = broken)) }
        val goal = input.sheets.getValue("savingsGoals").single()
        val funds = decodeSavingsFundEntries(goal.text("fundMovements"))
        val excessive = funds.last().copy(amountCents = 30000, allocations = funds.last().allocations.map { it.copy(cents = 30000) })
        val badFunds = input.sheets + ("savingsGoals" to listOf(JsonObject(goal + ("fundMovements" to JsonPrimitive(encodeSavingsFundEntries(listOf(funds.first(), excessive)))))))
        assertFailsWith<IllegalArgumentException> { prepareLedgerWorkbook("u", input.copy(sheets = badFunds)) }
    }
}
