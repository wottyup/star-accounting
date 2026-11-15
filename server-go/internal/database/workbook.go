package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/wottyup/star-accounting/server-go/internal/ledger"
)

func (store *Store) ImportWorkbook(ctx context.Context, userID string, input ledger.WorkbookRequest) (ledger.WorkbookResult, error) {
	rows, accountID, err := ledger.PrepareWorkbook(userID, input)
	if err != nil {
		return ledger.WorkbookResult{}, err
	}
	db, err := store.connection()
	if err != nil {
		return ledger.WorkbookResult{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ledger.WorkbookResult{}, err
	}
	defer tx.Rollback()
	// Serialize identical retries even when two requests arrive before either creates the account.
	var owner string
	if err = tx.QueryRowContext(ctx, "SELECT id FROM `user` WHERE id = ? FOR UPDATE", userID).Scan(&owner); err != nil {
		return ledger.WorkbookResult{}, err
	}
	var existing int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM account WHERE id = ? AND ownerId = ?", accountID, userID).Scan(&existing); err != nil {
		return ledger.WorkbookResult{}, err
	}
	if existing > 0 {
		return ledger.WorkbookResult{AccountID: accountID, Reused: true}, nil
	}
	count := 0
	for _, entity := range ledger.WorkbookEntities {
		for index, row := range rows[entity] {
			spec, err := entitySpecification(entity)
			if err != nil {
				return ledger.WorkbookResult{}, err
			}
			for _, field := range spec.Fields {
				if _, err = payloadValue(row, field); err != nil {
					return ledger.WorkbookResult{}, fmt.Errorf("%s 第 %d 行 %s: %w", entity, index+2, field.JSON, err)
				}
			}
			// ThemeConfig is unique per user. Restore the caller's theme, never another user's row.
			if entity == ledger.ThemeConfigs {
				var id string
				err = tx.QueryRowContext(ctx, "SELECT id FROM themeconfig WHERE userId = ?", userID).Scan(&id)
				if err == nil {
					row["id"], _ = json.Marshal(id)
				} else if err != sql.ErrNoRows {
					return ledger.WorkbookResult{}, err
				}
			}
			if err = upsertEntity(ctx, tx, entity, row); err != nil {
				return ledger.WorkbookResult{}, fmt.Errorf("%s 第 %d 行: %w", entity, index+2, err)
			}
			if entity == ledger.SavingsGoals {
				var funds string
				_ = json.Unmarshal(row["fundMovements"], &funds)
				var id string
				_ = json.Unmarshal(row["id"], &id)
				if _, err = tx.ExecContext(ctx, "UPDATE savingsgoal SET fundMovements = ? WHERE id = ?", funds, id); err != nil {
					return ledger.WorkbookResult{}, err
				}
			}
			count++
		}
	}
	for _, goal := range rows[ledger.SavingsGoals] {
		entries, err := ledger.DecodeSavingsFunds(savingsText(goal, "fundMovements"))
		if err != nil {
			return ledger.WorkbookResult{}, err
		}
		var recorded int64
		for _, plan := range rows[ledger.SavingsPlans] {
			if savingsText(plan, "goalId") == savingsText(goal, "id") {
				amount := savingsRecorded(plan)
				recorded += amount
				if ledger.SavingsSourceUsed(entries, stringPointer(savingsText(plan, "id"))) > amount {
					return ledger.WorkbookResult{}, fmt.Errorf("储蓄取用超过对应计划的存入金额")
				}
			}
		}
		if err := ledger.ValidateSavingsBasis(entries, savingsCents(goal, "currentAmount"), recorded); err != nil {
			return ledger.WorkbookResult{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return ledger.WorkbookResult{}, err
	}
	return ledger.WorkbookResult{AccountID: accountID, Imported: count}, nil
}
