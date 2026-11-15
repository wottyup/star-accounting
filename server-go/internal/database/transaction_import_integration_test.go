package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

func TestTransactionImportMySQL(t *testing.T) {
	dsn := os.Getenv("STAR_IMPORT_TEST_DSN")
	if dsn == "" {
		t.Skip("set STAR_IMPORT_TEST_DSN for an isolated import database")
	}
	config, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatal("invalid test DSN")
	}
	config.DBName = ""
	admin, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal("cannot open test connection")
	}
	defer admin.Close()
	name := fmt.Sprintf("star_import_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4"); err != nil {
		t.Fatal("cannot create test database")
	}
	defer admin.Exec("DROP DATABASE `" + name + "`")
	config.DBName = name
	db, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, table := range schemaTables {
		if table.Name == "account" || table.Name == "transaction" || table.Name == "loan" {
			if _, err := db.Exec(table.Create); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, account := range []string{"a", "b"} {
		if _, err := db.Exec("INSERT INTO account(id,name,ownerId) VALUES(?,?,?)", account, "test", "u-"+account); err != nil {
			t.Fatal(err)
		}
	}
	store := &Store{db: db}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	bill := func(id string, changes map[string]interface{}) json.RawMessage {
		value := map[string]interface{}{"id": id, "userId": "ignored", "accountId": "ignored", "amount": 35.5, "type": "EXPENSE", "category": "购物", "platform": "支付宝", "merchant": "商户", "shoppingPlatform": "淘宝", "date": "2026-11-15 12:00:00", "orderId": "order-" + id, "description": "商品明细", "createdAt": "2026-11-15 12:00:00", "updatedAt": "2026-11-15 12:00:00"}
		for key, item := range changes {
			value[key] = item
		}
		raw, _ := json.Marshal(value)
		return raw
	}
	t.Run("large", func(t *testing.T) {
		items := make([]json.RawMessage, 13411)
		for i := range items {
			items[i] = bill(fmt.Sprintf("large-%d", i), nil)
		}
		start := time.Now()
		for offset := 0; offset < len(items); offset += 1000 {
			end := offset + 1000
			if end > len(items) {
				end = len(items)
			}
			result, err := store.ImportTransactions(ctx, "a", "u-a", items[offset:end])
			if err != nil || result.Imported != end-offset || result.Errors != 0 {
				t.Fatalf("offset %d: %+v, %v", offset, result, err)
			}
		}
		t.Logf("13411 new bills in 14 requests: %s", time.Since(start))
		var count int
		var amount float64
		if err := db.QueryRow("SELECT COUNT(*),SUM(amount) FROM `transaction` WHERE accountId='a'").Scan(&count, &amount); err != nil || count != 13411 || amount != 476090.5 {
			t.Fatalf("stored totals: %d %.2f %v", count, amount, err)
		}
		start = time.Now()
		for offset := 0; offset < len(items); offset += 1000 {
			end := offset + 1000
			if end > len(items) {
				end = len(items)
			}
			result, err := store.ImportTransactions(ctx, "a", "u-a", items[offset:end])
			if err != nil || result.Skipped != end-offset || result.Imported != 0 {
				t.Fatalf("retry offset %d: %+v, %v", offset, result, err)
			}
		}
		t.Logf("13411 duplicate bills: %s", time.Since(start))
	})
	t.Run("partial_and_retry", func(t *testing.T) {
		items := []json.RawMessage{bill("valid-before", nil), bill("bad", map[string]interface{}{"category": strings.Repeat("x", 192), "orderId": "shared-order"}), bill("good", map[string]interface{}{"orderId": "shared-order"}), bill("after", nil)}
		result, err := store.ImportTransactions(ctx, "a", "u-a", items)
		if err != nil || result.Imported != 3 || result.Errors != 1 || result.FailedRows[0].LineNumber != 2 {
			t.Fatalf("partial: %+v, %v", result, err)
		}
		result, err = store.ImportTransactions(ctx, "a", "u-a", items)
		if err != nil || result.Imported != 0 || result.Skipped != 4 {
			t.Fatalf("retry: %+v, %v", result, err)
		}
	})

	t.Run("source_and_in_file_duplicates", func(t *testing.T) {
		items := []json.RawMessage{bill("source-original", map[string]interface{}{"orderId": nil}), bill("source-copy", map[string]interface{}{"sourceId": "source-original", "orderId": nil}), bill("source-original", map[string]interface{}{"orderId": nil})}
		result, err := store.ImportTransactions(ctx, "a", "u-a", items)
		if err != nil || result.Imported != 1 || result.Skipped != 2 {
			t.Fatalf("in-file duplicates: %+v %v", result, err)
		}
		result, err = store.ImportTransactions(ctx, "a", "u-a", []json.RawMessage{items[1]})
		if err != nil || result.Skipped != 1 {
			t.Fatalf("backup source retry: %+v %v", result, err)
		}
	})
	t.Run("foreign_collision", func(t *testing.T) {
		raw := bill("foreign-id", nil)
		if result, err := store.ImportTransactions(ctx, "b", "u-b", []json.RawMessage{raw}); err != nil || result.Imported != 1 {
			t.Fatalf("seed: %+v %v", result, err)
		}
		result, err := store.ImportTransactions(ctx, "a", "u-a", []json.RawMessage{raw})
		if err != nil || result.Errors != 1 || result.Imported != 0 {
			t.Fatalf("foreign collision: %+v %v", result, err)
		}
		var owner string
		if err := db.QueryRow("SELECT accountId FROM `transaction` WHERE id='foreign-id'").Scan(&owner); err != nil || owner != "b" {
			t.Fatalf("foreign bill modified: %s %v", owner, err)
		}
	})
	t.Run("loan_order_and_retry", func(t *testing.T) {
		_, err := db.Exec("INSERT INTO loan(id,userId,accountId,platform,totalAmount,remainingAmount,monthlyPayment,periods,paidPeriods,status) VALUES('l','u-a','a','test',500,500,100,5,0,'ACTIVE')")
		if err != nil {
			t.Fatal(err)
		}
		items := []json.RawMessage{bill("ordinary-before", nil), bill("repay-1", map[string]interface{}{"type": "REPAYMENT", "loanId": "l", "amount": 100}), bill("repay-2", map[string]interface{}{"type": "REPAYMENT", "loanId": "l", "amount": 100}), bill("ordinary-after", nil), bill("invalid-repay", map[string]interface{}{"type": "REPAYMENT", "loanId": "missing", "amount": 100})}
		result, err := store.ImportTransactions(ctx, "a", "u-a", items)
		if err != nil || result.Imported != 4 || result.Errors != 1 || result.LoanRepayments != 2 || result.LoanRepaymentAmount != 200 {
			t.Fatalf("loans: %+v %v", result, err)
		}
		result, err = store.ImportTransactions(ctx, "a", "u-a", items)
		if err != nil || result.Imported != 0 || result.Skipped != 4 || result.LoanRepayments != 0 {
			t.Fatalf("loan retry: %+v %v", result, err)
		}
		var balance string
		var periods int
		if err := db.QueryRow("SELECT remainingAmount,paidPeriods FROM loan WHERE id='l'").Scan(&balance, &periods); err != nil || periods != 2 || balance != "300.000000000000000000000000000000" {
			t.Fatalf("loan state: %s %d %v", balance, periods, err)
		}
	})
	t.Run("failed_loan_update_rolls_back_bill", func(t *testing.T) {
		if _, err := db.Exec("INSERT INTO loan(id,userId,accountId,platform,totalAmount,remainingAmount,monthlyPayment,periods,paidPeriods,status) VALUES('rollback-loan','u-a','a','test',500,500,100,5,0,'ACTIVE')"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec("CREATE TRIGGER reject_test_loan BEFORE UPDATE ON loan FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test repayment failure'"); err != nil {
			t.Fatal(err)
		}
		raw := bill("rollback-repay", map[string]interface{}{"type": "REPAYMENT", "loanId": "rollback-loan", "amount": 100})
		result, err := store.ImportTransactions(ctx, "a", "u-a", []json.RawMessage{raw})
		if err != nil || result.Errors != 1 || result.Imported != 0 {
			t.Fatalf("failed update: %+v %v", result, err)
		}
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM `transaction` WHERE id='rollback-repay'").Scan(&count); err != nil || count != 0 {
			t.Fatalf("partial repayment persisted: %d %v", count, err)
		}
		var balance float64
		if err := db.QueryRow("SELECT remainingAmount FROM loan WHERE id='rollback-loan'").Scan(&balance); err != nil || balance != 500 {
			t.Fatalf("failed loan changed balance: %.2f %v", balance, err)
		}
		if _, err := db.Exec("DROP TRIGGER reject_test_loan"); err != nil {
			t.Fatal(err)
		}
		result, err = store.ImportTransactions(ctx, "a", "u-a", []json.RawMessage{raw})
		if err != nil || result.Imported != 1 || result.LoanRepayments != 1 || result.LoanRepaymentAmount != 100 {
			t.Fatalf("retry after failure: %+v %v", result, err)
		}
		if err := db.QueryRow("SELECT remainingAmount FROM loan WHERE id='rollback-loan'").Scan(&balance); err != nil || balance != 400 {
			t.Fatalf("retry loan balance: %.2f %v", balance, err)
		}
	})

}
