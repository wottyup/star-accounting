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
	"github.com/wottyup/star-accounting/server-go/internal/ledger"
)

func TestWorkbookMinutePrecisionDates(t *testing.T) {
	for _, value := range []string{"2026-11-15T12:34", "2026-11-15 12:34", "2026-11-15T12:34:00", "2026-11-15"} {
		if _, err := parseDateTime(value); err != nil {
			t.Fatalf("cannot restore date %s: %v", value, err)
		}
	}
}

func TestWorkbookMySQL(t *testing.T) {
	dsn := os.Getenv("STAR_WORKBOOK_TEST_DSN")
	if dsn == "" {
		t.Skip("requires isolated test database")
	}
	config, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.DBName = ""
	config.ParseTime = true
	admin, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("star_workbook_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4"); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE `" + name + "`")
	config.DBName = name
	db, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = ensureSchema(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec("INSERT INTO `user`(id,email,password,role) VALUES('target-user','test@example.invalid','','USER')")
	if err != nil {
		t.Fatal(err)
	}
	store := &Store{db: db}
	data, err := os.ReadFile("../../../testdata/ledger-workbook.json")
	if err != nil {
		t.Fatal(err)
	}
	var input ledger.WorkbookRequest
	if err = json.Unmarshal(data, &input); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	result, err := store.ImportWorkbook(ctx, "target-user", input)
	if err != nil {
		t.Fatal(err)
	}
	if result.Imported != 13 || result.Reused {
		t.Fatalf("wrong result %+v", result)
	}
	rows, _, _ := ledger.PrepareWorkbook("target-user", input)
	var balance float64
	var plans, transactions int
	var funds string
	if err = db.QueryRow("SELECT remainingAmount FROM loan WHERE accountId=?", result.AccountID).Scan(&balance); err != nil || balance != 900 {
		t.Fatal("loan reduced twice", balance, err)
	}
	_ = db.QueryRow("SELECT COUNT(*) FROM savingsplan WHERE goalId=?", savingsText(rows[ledger.SavingsGoals][0], "id")).Scan(&plans)
	_ = db.QueryRow("SELECT COUNT(*) FROM `transaction` WHERE accountId=?", result.AccountID).Scan(&transactions)
	if plans != 1 || transactions != 2 {
		t.Fatal("lost dependent records", plans, transactions)
	}
	_ = db.QueryRow("SELECT fundMovements FROM savingsgoal WHERE accountId=?", result.AccountID).Scan(&funds)
	entries, err := ledger.DecodeSavingsFunds(funds)
	if err != nil || len(entries) != 2 {
		t.Fatal("lost savings history", err)
	}
	again, err := store.ImportWorkbook(ctx, "target-user", input)
	if err != nil || !again.Reused || again.Imported != 0 {
		t.Fatal("retry duplicated data", again, err)
	}
	// Fail on a late worksheet, after account, loans, goals and bills were inserted.
	input.ImportID = strings.Repeat("b", 64)
	input.Sheets[ledger.ImportErrorLogs][0]["lineNumber"] = json.RawMessage(`"bad-number"`)
	_, err = store.ImportWorkbook(ctx, "target-user", input)
	if err == nil {
		t.Fatal("accepted invalid late row")
	}
	_, badAccount, _ := ledger.PrepareWorkbook("target-user", input)
	var count int
	for _, entity := range []ledger.EntityType{ledger.Accounts, ledger.Loans, ledger.Transactions, ledger.SavingsGoals} {
		spec, _ := entitySpecification(entity)
		column := "accountId"
		if entity == ledger.Accounts {
			column = "id"
		}
		if err = db.QueryRow("SELECT COUNT(*) FROM `"+spec.Table+"` WHERE `"+column+"`=?", badAccount).Scan(&count); err != nil || count != 0 {
			t.Fatal("partial restore survived rollback", entity, count, err)
		}
	}
}
