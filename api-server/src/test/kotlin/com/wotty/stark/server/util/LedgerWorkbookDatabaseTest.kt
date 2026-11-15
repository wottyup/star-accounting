package com.wotty.stark.server.util

import java.io.File
import java.sql.DriverManager
import java.time.LocalDateTime
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.transactions.TransactionManager
import org.jetbrains.exposed.sql.transactions.transaction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class LedgerWorkbookDatabaseTest {
    @Test fun fullImportRetryAndRollbackInIsolatedMySQL() {
        // Never reads the development/production DB configuration.
        val endpoint = System.getenv("STAR_WORKBOOK_TEST_JDBC") ?: return
        val name = "star_workbook_test_${System.nanoTime()}"
        DriverManager.getConnection(endpoint, "root", "").use { admin ->
            admin.createStatement().use { it.execute("CREATE DATABASE `$name` CHARACTER SET utf8mb4") }
            val db = Database.connect("$endpoint$name?useUnicode=true&characterEncoding=UTF-8", driver = "com.mysql.cj.jdbc.Driver", user = "root", password = "")
            try {
                transaction(db) {
                    SchemaUtils.create(Users, Accounts, Transactions, Assets, Budgets, Loans, SavingsGoals, SavingsPlans, Subscriptions, TransactionCategoryRules, ImportErrorLogs, ExchangeRates, ThemeConfigs)
                    Users.insert {
                        it[Users.id] = "target-user"; it[Users.email] = "test@example.invalid"; it[Users.password] = ""; it[Users.role] = "USER"
                        it[Users.createdAt] = LocalDateTime.now(); it[Users.updatedAt] = LocalDateTime.now()
                    }
                }
                val input = Json.decodeFromString<LedgerWorkbookRequest>(File("../testdata/ledger-workbook.json").readText())
                val result = DatabaseFactory.importLedgerWorkbook("target-user", input)
                assertEquals(13, result.imported)
                transaction(db) {
                    assertEquals(900.0, Loans.selectAll().single()[Loans.remainingAmount].toDouble())
                    assertEquals(2L, Transactions.selectAll().count())
                    assertEquals(1L, SavingsPlans.selectAll().count())
                    assertEquals(1L, ExchangeRates.selectAll().count())
                    val funds = decodeSavingsFundEntries(SavingsGoals.selectAll().single()[SavingsGoals.fundMovements])
                    assertEquals(15000L, savingsOutstandingCents(funds))
                }
                assertTrue(DatabaseFactory.importLedgerWorkbook("target-user", input).reused)
                val badRow = input.sheets.getValue("importErrorLogs").single()
                val broken = input.copy(importId = "b".repeat(64), sheets = input.sheets + ("importErrorLogs" to listOf(JsonObject(badRow + ("lineNumber" to JsonPrimitive("invalid-number"))))))
                assertFailsWith<IllegalArgumentException> { DatabaseFactory.importLedgerWorkbook("target-user", broken) }
                transaction(db) {
                    assertEquals(1L, Accounts.selectAll().count())
                    assertEquals(1L, Loans.selectAll().count())
                    assertEquals(2L, Transactions.selectAll().count())
                    assertEquals(1L, SavingsGoals.selectAll().count())
                }
            } finally {
                TransactionManager.closeAndUnregister(db)
                admin.createStatement().use { it.execute("DROP DATABASE `$name`") }
            }
        }
    }
}
