package com.wotty.stark.server.util

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.security.MessageDigest

@Serializable
data class LedgerWorkbookRequest(val format: String, val schemaVersion: Int, val importId: String, val sheets: Map<String, List<JsonObject>>)
@Serializable
data class LedgerWorkbookResult(val accountId: String, val imported: Int = 0, val reused: Boolean = false)
val workbookEntities = listOf("accounts", "loans", "assets", "budgets", "savingsGoals", "savingsPlans", "subscriptions", "transactions", "categoryRules", "importErrorLogs", "exchangeRates", "themeConfigs")
private fun workbookHash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }.take(40)
private fun JsonObject.text(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()

fun prepareLedgerWorkbook(userId: String, input: LedgerWorkbookRequest): Pair<String, Map<String, List<JsonObject>>> {
    require(input.format == "star-accounting-workbook" && input.schemaVersion == 1 && Regex("^[a-f0-9]{64}$").matches(input.importId)) { "账本工作簿格式或版本不受支持" }
    require(input.sheets.keys == workbookEntities.toSet() && input.sheets.getValue("accounts").size == 1 && input.sheets.getValue("themeConfigs").size <= 1 && input.sheets.values.sumOf { it.size } <= 500000) { "工作表缺失、未知或记录数量无效" }
    val accountId = "workbook-" + workbookHash("$userId\u0000${input.importId}")
    val ids = input.sheets.mapValues { (entity, rows) ->
        require(rows.all { it.text("id").isNotEmpty() && it.text("id").length <= 191 && it.size <= 100 && it.keys.none { key -> key in listOf("__deleted", "password", "token") } } && rows.map { it.text("id") }.distinct().size == rows.size) { "$entity 工作表含无效或重复 ID" }
        rows.associate { it.text("id") to if (entity == "accounts") accountId else "wb-" + workbookHash("$accountId\u0000$entity\u0000${it.text("id")}") }
    }
    fun reference(entity: String, id: String): String = ids.getValue(entity)[id] ?: throw IllegalArgumentException("关联记录不存在：$entity/$id")
    val originalAccount = input.sheets.getValue("accounts").single().text("id")
    val planGoal = input.sheets.getValue("savingsPlans").associate { it.text("id") to it.text("goalId") }
    val normalized = input.sheets.mapValues { (entity, rows) -> rows.map { row ->
        val values = row.toMutableMap()
        values["id"] = JsonPrimitive(reference(entity, row.text("id")))
        when (entity) {
            "accounts" -> { values["ownerId"] = JsonPrimitive(userId); values["name"] = JsonPrimitive(row.text("name") + "（导入）") }
            "savingsPlans" -> values["goalId"] = JsonPrimitive(reference("savingsGoals", row.text("goalId")))
            "exchangeRates" -> Unit
            else -> {
                require(entity == "themeConfigs" || row.text("accountId") == originalAccount) { "记录不属于导出账本：$entity" }
                values["accountId"] = JsonPrimitive(accountId); values["userId"] = JsonPrimitive(userId)
            }
        }
        if (entity == "transactions") {
            if (row.text("loanId").isNotEmpty()) values["loanId"] = JsonPrimitive(reference("loans", row.text("loanId")))
            ids.getValue("subscriptions").forEach { (old, next) ->
                val prefix = "subscription-$old-"
                if (row.text("id").startsWith(prefix)) values["id"] = JsonPrimitive("subscription-$next-" + row.text("id").removePrefix(prefix))
                val orderPrefix = "subscription:$old:"
                if (row.text("orderId").startsWith(orderPrefix)) values["orderId"] = JsonPrimitive("subscription:$next:" + row.text("orderId").removePrefix(orderPrefix))
            }
        }
        if (entity == "savingsGoals") {
            val entries = decodeSavingsFundEntries(row.text("fundMovements"))
            require(entries.map { it.id }.distinct().size == entries.size) { "储蓄资金操作 ID 重复" }
            val remaining = entries.filter { it.kind == "WITHDRAWAL" }.associate { entry ->
                entry.id to entry.allocations.groupBy { it.planId }.mapValues { (_, parts) -> parts.sumOf { it.cents } }.toMutableMap()
            }
            val mapped = entries.map { entry ->
                if (entry.kind == "WITHDRAWAL") require(entry.withdrawalId == null) { "取用记录不能关联另一笔取用。" }
                if (entry.kind == "REPLENISHMENT") {
                    val parts = remaining[entry.withdrawalId] ?: throw IllegalArgumentException("储蓄补齐关联的取用不存在")
                    entry.allocations.forEach { part ->
                        val left = (parts[part.planId] ?: 0) - part.cents
                        require(left >= 0) { "储蓄补齐超过对应来源的取用金额" }
                        parts[part.planId] = left
                    }
                }
                entry.copy(allocations = entry.allocations.map { part ->
                    require(part.planId == null || planGoal[part.planId] == row.text("id")) { "储蓄资金分配关联了其他目标的计划" }
                    part.copy(planId = part.planId?.let { reference("savingsPlans", it) })
                })
            }
            values["fundMovements"] = JsonPrimitive(encodeSavingsFundEntries(mapped))
        }
        JsonObject(values)
    } }
    return accountId to normalized
}
