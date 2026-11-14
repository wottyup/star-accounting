package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/wottyup/star-accounting/server-go/internal/ledger"
)

// The opt-in DSN needs CREATE/DROP DATABASE permission. Tests use only a fresh,
// uniquely named database and drop it on completion; no existing ledger is touched.
func TestSavingsFundsMySQL(t *testing.T) {
	dsn := os.Getenv("STAR_SAVINGS_TEST_DSN")
	if dsn == "" {
		t.Skip("set STAR_SAVINGS_TEST_DSN to run isolated MySQL transactions")
	}
	config, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatal("invalid test DSN")
	}
	config.DBName = ""
	config.ParseTime = true
	admin, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal("test connection unavailable")
	}
	defer admin.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	name := fmt.Sprintf("star_savings_test_%d", time.Now().UnixNano())
	if _, err := admin.ExecContext(ctx, "CREATE DATABASE `"+name+"` CHARACTER SET utf8mb4"); err != nil {
		t.Fatal("cannot create isolated test database")
	}
	defer admin.ExecContext(context.Background(), "DROP DATABASE `"+name+"`")
	config.DBName = name
	db, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// Only savings and account tables are needed. The production schema definitions
	// ensure the test exercises the same column types and migration shape.
	for _, table := range schemaTables {
		if table.Name == "account" || table.Name == "savingsgoal" || table.Name == "savingsplan" {
			if _, err := db.ExecContext(ctx, table.Create); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, query := range []string{
		"INSERT INTO account(id,name,ownerId) VALUES('a','test','u')",
		"INSERT INTO savingsgoal(id,userId,accountId,name,currentAmount,targetAmount) VALUES('g','u','a','test',3500,11500)",
		"INSERT INTO savingsplan(id,goalId,amount,actualAmount,status,month) VALUES('p1','g',2000,2000,'COMPLETED','2026-09'),('p2','g',1500,1500,'COMPLETED','2026-10')",
	} {
		if _, err := db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	store := &Store{db: db}
	request := ledger.SavingsFundInput{ID: "w", Kind: "WITHDRAWAL", AmountCents: 100000, Date: "2026-11-14T12:00", Note: "test"}
	if _, err := store.RecordSavingsFundMovement(ctx, "foreign", "g", request, "2026-11-14 12:00:00"); err == nil {
		t.Fatal("foreign account accepted")
	}
	if _, err := store.RecordSavingsFundMovement(ctx, "u", "g", request, "2026-11-14 12:00:00"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RecordSavingsFundMovement(ctx, "u", "g", request, "2026-11-14 12:00:01"); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteEntity(ctx, ledger.SavingsPlans, "p1"); err == nil {
		t.Fatal("deleted outstanding source")
	}
	if err := store.DeleteEntity(ctx, ledger.SavingsGoals, "g"); err == nil {
		t.Fatal("deleted outstanding withdrawal")
	}
	id := "w"
	request = ledger.SavingsFundInput{ID: "r", Kind: "REPLENISHMENT", WithdrawalID: &id, AmountCents: 40000, Date: "2026-11-14T12:01", Note: "test"}
	if _, err := store.RecordSavingsFundMovement(ctx, "u", "g", request, "2026-11-14 12:01:00"); err != nil {
		t.Fatal(err)
	}
	// Two requests race for the same remaining 2900. Only one 2000 withdrawal fits.
	var wait sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wait.Add(1)
		go func(i int) {
			defer wait.Done()
			_, err := store.RecordSavingsFundMovement(ctx, "u", "g", ledger.SavingsFundInput{ID: fmt.Sprintf("race-%d", i), Kind: "WITHDRAWAL", AmountCents: 200000, Date: "2026-11-14T12:02", Note: "race"}, "2026-11-14 12:02:00")
			results <- err
		}(i)
	}
	wait.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("concurrent withdrawals: %d succeeded, want 1", success)
	}
	raw, exists, err := store.GetEntity(ctx, ledger.SavingsGoals, "g")
	if err != nil || !exists {
		t.Fatal("goal reload failed")
	}
	var goal map[string]json.RawMessage
	_ = json.Unmarshal(raw, &goal)
	entries, err := ledger.DecodeSavingsFunds(savingsText(goal, "fundMovements"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 || ledger.SavingsOutstanding(entries) != 260000 {
		t.Fatalf("unexpected persisted ledger: %+v", entries)
	}
	planRaw, _, err := store.GetEntity(ctx, ledger.SavingsPlans, "p1")
	if err != nil {
		t.Fatal(err)
	}
	var plan map[string]json.RawMessage
	_ = json.Unmarshal(planRaw, &plan)
	deposit := ledger.SavingsDepositInput{AmountCents: 100000, Date: "2026-11-14T12:03:00", ExpectedUpdatedAt: savingsText(plan, "updatedAt")}
	if err := store.RecordSavingsDeposit(ctx, "u", "p1", deposit, "2026-11-14 12:03:00"); err == nil {
		t.Fatal("reduced an outstanding source deposit")
	}
	raw, _, _ = store.GetEntity(ctx, ledger.SavingsGoals, "g")
	_ = json.Unmarshal(raw, &goal)
	if savingsCents(goal, "currentAmount") != 350000 {
		t.Fatal("failed deposit partially changed goal")
	}
	deposit.AmountCents = 250000
	if err := store.RecordSavingsDeposit(ctx, "u", "p1", deposit, "2026-11-14 12:03:00"); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordSavingsDeposit(ctx, "u", "p1", deposit, "2026-11-14 12:03:01"); err != nil {
		t.Fatal("deposit retry failed", err)
	}
	raw, _, _ = store.GetEntity(ctx, ledger.SavingsGoals, "g")
	_ = json.Unmarshal(raw, &goal)
	if savingsCents(goal, "currentAmount") != 400000 {
		t.Fatal("deposit retry duplicated money")
	}

	// Saving a stale goal, even with a forged empty ledger, must retain real history.
	goal["fundMovements"] = json.RawMessage(`null`)
	if err := store.UpsertEntity(ctx, ledger.SavingsGoals, goal); err != nil {
		t.Fatal(err)
	}
	raw, _, err = store.GetEntity(ctx, ledger.SavingsGoals, "g")
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(raw, &goal)
	entries, err = ledger.DecodeSavingsFunds(savingsText(goal, "fundMovements"))
	if err != nil || len(entries) != 3 {
		t.Fatal("ordinary save replaced ledger")
	}
}
