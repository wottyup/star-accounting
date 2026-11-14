package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/wottyup/star-accounting/server-go/internal/ledger"
)

func savingsText(payload map[string]json.RawMessage, key string) string {
	var value string
	_ = json.Unmarshal(payload[key], &value)
	return value
}
func savingsCents(payload map[string]json.RawMessage, key string) int64 {
	text := strings.Trim(string(payload[key]), "\"")
	amount, _ := strconv.ParseFloat(text, 64)
	return int64(math.Round(amount * 100))
}
func savingsRecorded(payload map[string]json.RawMessage) int64 {
	if savingsText(payload, "status") != "COMPLETED" {
		return 0
	}
	if raw := payload["actualAmount"]; len(raw) > 0 && string(raw) != "null" {
		return savingsCents(payload, "actualAmount")
	}
	return savingsCents(payload, "amount")
}

func savingsPayloads(ctx context.Context, tx *sql.Tx, entity ledger.EntityType, where string, args ...interface{}) ([]map[string]json.RawMessage, error) {
	spec, err := entitySpecification(entity)
	if err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT "+strings.Join(selectColumns(spec), ",")+" FROM `"+spec.Table+"` WHERE "+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]json.RawMessage{}
	for rows.Next() {
		raw, err := scanPayload(rows, spec)
		if err != nil {
			return nil, err
		}
		var payload map[string]json.RawMessage
		if err := json.Unmarshal(raw, &payload); err != nil {
			return nil, err
		}
		items = append(items, payload)
	}
	return items, rows.Err()
}
func lockSavingsState(ctx context.Context, tx *sql.Tx, id string) (map[string]json.RawMessage, []map[string]json.RawMessage, []ledger.SavingsFundEntry, error) {
	goals, err := savingsPayloads(ctx, tx, ledger.SavingsGoals, "id = ? FOR UPDATE", id)
	if err != nil {
		return nil, nil, nil, err
	}
	if len(goals) == 0 {
		return nil, nil, nil, nil
	}
	plans, err := savingsPayloads(ctx, tx, ledger.SavingsPlans, "goalId = ?", id)
	if err != nil {
		return nil, nil, nil, err
	}
	entries, err := ledger.DecodeSavingsFunds(savingsText(goals[0], "fundMovements"))
	return goals[0], plans, entries, err
}
func (store *Store) RecordSavingsFundMovement(ctx context.Context, userID, goalID string, input ledger.SavingsFundInput, now string) (json.RawMessage, error) {
	db, err := store.connection()
	if err != nil {
		return nil, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	goal, rows, entries, err := lockSavingsState(ctx, tx, goalID)
	if err != nil {
		return nil, err
	}
	if goal == nil {
		return nil, &ledger.Error{Status: 403, Message: "无权访问该储蓄目标。"}
	}
	var owner string
	if err := tx.QueryRowContext(ctx, "SELECT ownerId FROM account WHERE id = ?", savingsText(goal, "accountId")).Scan(&owner); err != nil {
		return nil, err
	}
	if owner != userID {
		return nil, &ledger.Error{Status: 403, Message: "无权访问该储蓄目标。"}
	}
	plans := []ledger.SavingsFundPlan{}
	for _, row := range rows {
		plans = append(plans, ledger.SavingsFundPlan{ID: savingsText(row, "id"), Month: savingsText(row, "month"), Cents: savingsRecorded(row)})
	}
	next, err := ledger.AppendSavingsFund(entries, savingsCents(goal, "currentAmount"), plans, input, now)
	if err != nil {
		return nil, err
	}
	if len(next) != len(entries) {
		encoded, err := json.Marshal(next)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE savingsgoal SET fundMovements = ?, updatedAt = ? WHERE id = ?", string(encoded), now, goalID); err != nil {
			return nil, err
		}
		goal["fundMovements"], _ = json.Marshal(string(encoded))
		goal["updatedAt"], _ = json.Marshal(now)
	}
	result, err := json.Marshal(goal)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
func (store *Store) saveSavingsEntity(ctx context.Context, db *sql.DB, entity ledger.EntityType, payload map[string]json.RawMessage) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	id := savingsText(payload, "id")
	goalID := id
	if entity == ledger.SavingsPlans {
		goalID = savingsText(payload, "goalId")
	}
	goal, plans, entries, err := lockSavingsState(ctx, tx, goalID)
	if err != nil {
		return err
	}
	if entity == ledger.SavingsGoals && goal != nil {
		if len(entries) > 0 && savingsText(goal, "accountId") != savingsText(payload, "accountId") {
			return &ledger.Error{Status: 400, Message: "有资金流水的目标不能移动到账本。"}
		}
		var recorded int64
		for _, plan := range plans {
			recorded += savingsRecorded(plan)
		}
		if err := ledger.ValidateSavingsBasis(entries, savingsCents(payload, "currentAmount"), recorded); err != nil {
			return err
		}
	}
	if entity == ledger.SavingsPlans {
		if goal == nil {
			return &ledger.Error{Status: 400, Message: "储蓄目标不存在。"}
		}
		old, err := savingsPayloads(ctx, tx, ledger.SavingsPlans, "id = ?", id)
		if err != nil {
			return err
		}
		if len(old) > 0 && savingsText(old[0], "goalId") != goalID {
			return &ledger.Error{Status: 400, Message: "不能移动已有储蓄计划，请在原目标中修改。"}
		}
		used := ledger.SavingsSourceUsed(entries, &id)
		if used > savingsRecorded(payload) || (used > 0 && (len(old) == 0 || savingsText(old[0], "month") != savingsText(payload, "month"))) {
			return &ledger.Error{Status: 400, Message: "这项计划还有未补齐取用，请先补齐后再修改。"}
		}
		recorded := savingsRecorded(payload)
		for _, plan := range plans {
			if savingsText(plan, "id") != id {
				recorded += savingsRecorded(plan)
			}
		}
		if err := ledger.ValidateSavingsBasis(entries, savingsCents(goal, "currentAmount"), recorded); err != nil {
			return err
		}
	}
	if err := upsertEntity(ctx, tx, entity, payload); err != nil {
		return err
	}
	return tx.Commit()
}
func (store *Store) deleteSavingsEntity(ctx context.Context, db *sql.DB, entity ledger.EntityType, id string) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	goalID := id
	if entity == ledger.SavingsPlans {
		var value string
		if err := tx.QueryRowContext(ctx, "SELECT goalId FROM savingsplan WHERE id = ?", id).Scan(&value); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}
		goalID = value
	}
	_, _, entries, err := lockSavingsState(ctx, tx, goalID)
	if err != nil {
		return err
	}
	if entity == ledger.SavingsGoals {
		if ledger.SavingsOutstanding(entries) > 0 {
			return &ledger.Error{Status: 400, Message: "该目标还有未补齐取用，请补齐后再删除。"}
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM savingsplan WHERE goalId = ?", id); err != nil {
			return err
		}
	} else if ledger.SavingsSourceUsed(entries, &id) > 0 {
		return &ledger.Error{Status: 400, Message: "这项计划还有未补齐取用，请先补齐后再删除。"}
	}
	spec, _ := entitySpecification(entity)
	if _, err := tx.ExecContext(ctx, "DELETE FROM `"+spec.Table+"` WHERE id = ?", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (store *Store) RecordSavingsDeposit(ctx context.Context, userID, planID string, input ledger.SavingsDepositInput, now string) error {
	if input.AmountCents <= 0 || input.AmountCents > 1_000_000_000_000 || (input.ProofImage != nil && len(*input.ProofImage) > 10_000_000) {
		return &ledger.Error{Status: 400, Message: "请核对金额和图片。"}
	}
	date, err := parseDateTime(input.Date)
	if err != nil {
		return &ledger.Error{Status: 400, Message: "请填写有效日期和时间。"}
	}
	db, err := store.connection()
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var goalID string
	if err := tx.QueryRowContext(ctx, "SELECT goalId FROM savingsplan WHERE id = ?", planID).Scan(&goalID); err != nil {
		return &ledger.Error{Status: 403, Message: "无权访问该储蓄计划。"}
	}
	goal, plans, entries, err := lockSavingsState(ctx, tx, goalID)
	if err != nil {
		return err
	}
	if goal == nil {
		return &ledger.Error{Status: 403, Message: "无权访问该储蓄计划。"}
	}
	var owner string
	if err := tx.QueryRowContext(ctx, "SELECT ownerId FROM account WHERE id = ?", savingsText(goal, "accountId")).Scan(&owner); err != nil {
		return err
	}
	if owner != userID {
		return &ledger.Error{Status: 403, Message: "无权访问该储蓄计划。"}
	}
	var plan map[string]json.RawMessage
	var total int64
	for _, row := range plans {
		if savingsText(row, "id") == planID {
			plan = row
			total += input.AmountCents
		} else {
			total += savingsRecorded(row)
		}
	}
	if plan == nil {
		return &ledger.Error{Status: 400, Message: "储蓄计划不存在。"}
	}
	proof := savingsText(plan, "proofImage")
	sameProof := input.ProofImage == nil && string(plan["proofImage"]) == "null" || input.ProofImage != nil && proof == *input.ProofImage
	storedDate, _ := parseDateTime(savingsText(plan, "actualDate"))
	if savingsText(plan, "status") == "COMPLETED" && savingsRecorded(plan) == input.AmountCents && storedDate.Equal(date) && sameProof {
		return nil
	}
	if savingsText(plan, "updatedAt") != input.ExpectedUpdatedAt {
		return &ledger.Error{Status: 400, Message: "存入记录已变更，请刷新后再修改。"}
	}
	if ledger.SavingsSourceUsed(entries, &planID) > input.AmountCents {
		return &ledger.Error{Status: 400, Message: "这项计划还有未补齐取用，请补齐后再减少存款。"}
	}
	gross := savingsCents(goal, "currentAmount") - savingsRecorded(plan) + input.AmountCents
	if gross < 0 {
		gross = 0
	}
	if err := ledger.ValidateSavingsBasis(entries, gross, total); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE savingsgoal SET currentAmount = ?, updatedAt = ? WHERE id = ?", fmt.Sprintf("%d.%02d", gross/100, gross%100), now, goalID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE savingsplan SET status = 'COMPLETED', actualAmount = ?, actualDate = ?, proofImage = ?, updatedAt = ? WHERE id = ?", fmt.Sprintf("%d.%02d", input.AmountCents/100, input.AmountCents%100), date, input.ProofImage, now, planID); err != nil {
		return err
	}
	return tx.Commit()
}
