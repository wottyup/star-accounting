package com.wotty.stark.server.util

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.LocalDateTime

@Serializable
data class SavingsFundInput(
    val id: String,
    val kind: String,
    val amountCents: Long,
    val date: String,
    val note: String = "",
    val withdrawalId: String? = null,
)

@Serializable
data class SavingsDepositInput(val amountCents: Long, val date: String, val proofImage: String? = null, val expectedUpdatedAt: String)

@Serializable
data class SavingsFundAllocation(val planId: String? = null, val month: String? = null, val cents: Long)

@Serializable
data class SavingsFundEntry(
    val id: String, val kind: String, val amountCents: Long, val date: String, val note: String,
    val withdrawalId: String? = null, val allocations: List<SavingsFundAllocation>, val createdAt: String,
)

data class SavingsFundPlan(val id: String, val month: String, val cents: Long)

private val fundJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

fun decodeSavingsFundEntries(value: String?): List<SavingsFundEntry> {
    val entries = if (value.isNullOrEmpty()) emptyList() else fundJson.decodeFromString<List<SavingsFundEntry>>(value)
    require(entries.all { it.kind in listOf("WITHDRAWAL", "REPLENISHMENT") && it.amountCents > 0 && it.allocations.all { part -> part.cents > 0 } && it.allocations.sumOf { part -> part.cents } == it.amountCents }) { "储蓄资金记录无效，请刷新后重试。" }
    return entries
}

fun encodeSavingsFundEntries(entries: List<SavingsFundEntry>): String = fundJson.encodeToString(entries)

fun savingsOutstandingCents(entries: List<SavingsFundEntry>): Long = entries.sumOf { if (it.kind == "WITHDRAWAL") it.amountCents else -it.amountCents }

fun savingsSourceUsedCents(entries: List<SavingsFundEntry>, planId: String?): Long = entries.sumOf { entry ->
    (if (entry.kind == "WITHDRAWAL") 1L else -1L) * entry.allocations.filter { it.planId == planId }.sumOf { it.cents }
}

private fun allocateSavings(parts: List<SavingsFundAllocation>, amount: Long): List<SavingsFundAllocation> {
    var remaining = amount
    val result = parts.mapNotNull { part ->
        val cents = minOf(remaining, part.cents)
        remaining -= cents
        if (cents > 0) part.copy(cents = cents) else null
    }
    require(remaining == 0L) { "可用金额不足，请刷新后核对。" }
    return result
}

fun appendSavingsFundEntry(
    existing: List<SavingsFundEntry>, currentAmountCents: Long, plans: List<SavingsFundPlan>, input: SavingsFundInput, now: String,
): List<SavingsFundEntry> {
    require(input.id.isNotBlank() && input.id.length <= 191 && input.kind in listOf("WITHDRAWAL", "REPLENISHMENT") && input.amountCents in 1..1_000_000_000_000L && input.note.length <= 500) { "请核对金额、时间和备注。" }
    require(Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2})?$").matches(input.date) && runCatching { LocalDateTime.parse(input.date) }.isSuccess) { "请填写有效日期和时间。" }
    existing.find { it.id == input.id }?.let { entry ->
        require(entry.kind == input.kind && entry.amountCents == input.amountCents && entry.date == input.date && entry.note == input.note && entry.withdrawalId == input.withdrawalId) { "这笔操作已保存，请刷新核对记录。" }
        return existing
    }
    val parts = if (input.kind == "WITHDRAWAL") {
        require(input.withdrawalId == null) { "取用记录不能关联另一笔取用。" }
        val legacy = (currentAmountCents - plans.sumOf { it.cents }).coerceAtLeast(0) - savingsSourceUsedCents(existing, null)
        val sources = listOf(SavingsFundAllocation(cents = legacy)) + plans.sortedWith(compareBy({ it.month }, { it.id })).map { plan ->
            SavingsFundAllocation(plan.id, plan.month, (plan.cents - savingsSourceUsedCents(existing, plan.id)).coerceAtLeast(0))
        }
        require(input.amountCents <= sources.sumOf { it.cents.coerceAtLeast(0) }) { "取用金额不能超过当前储蓄余额。" }
        sources.filter { it.cents > 0 }
    } else {
        val withdrawal = existing.find { it.id == input.withdrawalId && it.kind == "WITHDRAWAL" }
        require(withdrawal != null) { "找不到对应的取用记录，请刷新后重试。" }
        val returned = existing.filter { it.kind == "REPLENISHMENT" && it.withdrawalId == withdrawal.id }.flatMap { it.allocations }
        val sources = withdrawal.allocations.map { part -> part.copy(cents = part.cents - returned.filter { it.planId == part.planId }.sumOf { it.cents }) }.filter { it.cents > 0 }
        require(input.amountCents <= sources.sumOf { it.cents }) { "补齐金额不能超过这笔取用的待补齐金额。" }
        sources
    }
    return existing + SavingsFundEntry(input.id, input.kind, input.amountCents, input.date, input.note, input.withdrawalId, allocateSavings(parts, input.amountCents), now)
}
