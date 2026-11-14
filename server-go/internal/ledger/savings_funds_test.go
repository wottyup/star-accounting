package ledger

import "testing"

func fundRequest(id string, cents int64, withdrawal *string) SavingsFundInput {
	kind := "WITHDRAWAL"
	if withdrawal != nil {
		kind = "REPLENISHMENT"
	}
	return SavingsFundInput{ID: id, Kind: kind, AmountCents: cents, Date: "2026-11-14T12:00", Note: "test", WithdrawalID: withdrawal}
}
func TestSavingsWithdrawalAndPartialReplenishment(t *testing.T) {
	plans := []SavingsFundPlan{{"p1", "2026-09", 200000}, {"p2", "2026-10", 150000}}
	entries, err := AppendSavingsFund(nil, 350000, plans, fundRequest("w", 100000, nil), "now")
	if err != nil {
		t.Fatal(err)
	}
	if SavingsOutstanding(entries) != 100000 {
		t.Fatal(entries)
	}
	id := "w"
	entries, err = AppendSavingsFund(entries, 350000, plans, fundRequest("r1", 40000, &id), "now")
	if err != nil {
		t.Fatal(err)
	}
	if SavingsOutstanding(entries) != 60000 {
		t.Fatal(entries)
	}
	entries, err = AppendSavingsFund(entries, 350000, plans, fundRequest("r2", 60000, &id), "now")
	if err != nil {
		t.Fatal(err)
	}
	source := "p1"
	if SavingsOutstanding(entries) != 0 || SavingsSourceUsed(entries, &source) != 0 {
		t.Fatal(entries)
	}
}
func TestSavingsSourcesRetryAndLimits(t *testing.T) {
	plans := []SavingsFundPlan{{"p2", "2026-10", 150000}, {"p1", "2026-09", 200000}}
	request := fundRequest("w", 270000, nil)
	entries, err := AppendSavingsFund(nil, 400000, plans, request, "now")
	if err != nil {
		t.Fatal(err)
	}
	parts := entries[0].Allocations
	if len(parts) != 3 || parts[0].PlanID != nil || parts[0].Cents != 50000 || *parts[1].PlanID != "p1" || parts[2].Cents != 20000 {
		t.Fatal(parts)
	}
	retry, err := AppendSavingsFund(entries, 400000, plans, request, "now")
	if err != nil || len(retry) != 1 {
		t.Fatalf("retry: %v %v", retry, err)
	}
	id := "w"
	for _, invalid := range []SavingsFundInput{fundRequest("x", 130001, nil), fundRequest("r", 270001, &id), fundRequest("w", 1, nil), fundRequest("x", 0, nil)} {
		if _, err := AppendSavingsFund(entries, 400000, plans, invalid, "now"); err == nil {
			t.Fatalf("accepted invalid request: %+v", invalid)
		}
	}
	request.ID = "date"
	request.Date = "2026-02-31T12:00"
	if _, err := AppendSavingsFund(entries, 400000, plans, request, "now"); err == nil {
		t.Fatal("accepted invalid date")
	}
	if err := ValidateSavingsBasis(entries, 350000, 350000); err == nil {
		t.Fatal("allowed destruction of outstanding legacy source")
	}
}
func TestSavingsCents(t *testing.T) {
	plans := []SavingsFundPlan{{"p", "2026-11", 30}}
	entries, err := AppendSavingsFund(nil, 0, plans, fundRequest("w", 29, nil), "now")
	if err != nil {
		t.Fatal(err)
	}
	id := "w"
	entries, err = AppendSavingsFund(entries, 0, plans, fundRequest("r", 7, &id), "now")
	if err != nil {
		t.Fatal(err)
	}
	if SavingsOutstanding(entries) != 22 {
		t.Fatal(entries)
	}
}
