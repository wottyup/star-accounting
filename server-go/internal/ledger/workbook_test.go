package ledger

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func workbookFixture(t *testing.T) WorkbookRequest {
	t.Helper()
	data, err := os.ReadFile("../../../testdata/ledger-workbook.json")
	if err != nil {
		t.Fatal(err)
	}
	var input WorkbookRequest
	if err = json.Unmarshal(data, &input); err != nil {
		t.Fatal(err)
	}
	return input
}
func TestWorkbookRebindsRelationships(t *testing.T) {
	input := workbookFixture(t)
	rows, account, err := PrepareWorkbook("signed-in-user", input)
	if err != nil {
		t.Fatal(err)
	}
	if workbookText(rows[Accounts][0], "ownerId") != "signed-in-user" || account == "source-account" {
		t.Fatal("account identity was not rebound")
	}
	goal := workbookText(rows[SavingsGoals][0], "id")
	plan := workbookText(rows[SavingsPlans][0], "id")
	if workbookText(rows[SavingsPlans][0], "goalId") != goal {
		t.Fatal("broken goal reference")
	}
	funds, err := DecodeSavingsFunds(workbookText(rows[SavingsGoals][0], "fundMovements"))
	if err != nil || funds[0].Allocations[0].PlanID == nil || *funds[0].Allocations[0].PlanID != plan {
		t.Fatal("fund allocation not remapped", err)
	}
	sub := workbookText(rows[Subscriptions][0], "id")
	if workbookText(rows[Transactions][0], "id") != "subscription-"+sub+"-2026-11" {
		t.Fatal("would duplicate recurring charge")
	}
	if workbookText(rows[Transactions][1], "loanId") != workbookText(rows[Loans][0], "id") {
		t.Fatal("broken loan reference")
	}
	_, same, _ := PrepareWorkbook("signed-in-user", input)
	_, other, _ := PrepareWorkbook("other-user", input)
	if same != account || other == account {
		t.Fatal("retry or identity isolation failed")
	}
}
func TestWorkbookRejectsBrokenData(t *testing.T) {
	for _, change := range []func(*WorkbookRequest){
		func(w *WorkbookRequest) { delete(w.Sheets, Budgets) },
		func(w *WorkbookRequest) { w.Sheets[Users] = []map[string]json.RawMessage{} },
		func(w *WorkbookRequest) { workbookPut(w.Sheets[SavingsPlans][0], "goalId", "missing") },
		func(w *WorkbookRequest) { workbookPut(w.Sheets[Transactions][0], "accountId", "other-account") },
		func(w *WorkbookRequest) { w.Sheets[Assets] = append(w.Sheets[Assets], w.Sheets[Assets][0]) },
		func(w *WorkbookRequest) { w.ImportID = strings.Repeat("z", 64) },
	} {
		input := workbookFixture(t)
		change(&input)
		if _, _, err := PrepareWorkbook("u", input); err == nil {
			t.Fatal("accepted broken workbook")
		}
	}
}
