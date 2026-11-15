package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strings"

	"github.com/wottyup/star-accounting/server-go/internal/ledger"
)

type preparedImportRow struct {
	index       int
	raw         json.RawMessage
	id, orderID string
	arguments   []interface{}
}

// Keep SQL statements small even when the client sends a larger HTTP batch.
const importSQLBatchSize = 200

func importTransactionsInBatches(ctx context.Context, db *sql.DB, accountID, userID string, items []json.RawMessage) (ledger.ImportResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ledger.ImportResult{}, err
	}
	defer tx.Rollback()
	ids, orders, err := transactionIdentifiersForImport(ctx, tx, accountID, items)
	if err != nil {
		return ledger.ImportResult{}, err
	}
	result := ledger.ImportResult{FailedRows: make([]ledger.ImportFailure, 0)}
	fields := entitySpecs[ledger.Transactions].Fields
	columns := selectColumns(entitySpecs[ledger.Transactions])
	prefix := "INSERT INTO `transaction` (" + strings.Join(columns, ",") + ") VALUES "
	placeholder := "(" + strings.TrimRight(strings.Repeat("?,", len(fields)), ",") + ")"
	pending := make([]preparedImportRow, 0, importSQLBatchSize)
	pendingIDs, pendingOrders := map[string]bool{}, map[string]bool{}
	mark := func(row preparedImportRow) {
		ids[row.id] = true
		if strings.TrimSpace(row.orderID) != "" {
			orders[row.orderID] = true
		}
		result.Imported++
	}
	flush := func() error {
		if len(pending) == 0 {
			return nil
		}
		arguments := make([]interface{}, 0, len(pending)*len(fields))
		for _, row := range pending {
			arguments = append(arguments, row.arguments...)
		}
		if _, err := tx.ExecContext(ctx, "SAVEPOINT import_batch"); err != nil {
			return err
		}
		query := prefix + strings.TrimRight(strings.Repeat(placeholder+",", len(pending)), ",")
		if _, err := tx.ExecContext(ctx, query, arguments...); err == nil {
			for _, row := range pending {
				mark(row)
			}
		} else {
			// Roll back the whole statement before diagnosing bad rows. A deadlock
			// that rolled back the transaction makes this fail and aborts the request.
			if _, rollbackErr := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT import_batch"); rollbackErr != nil {
				return rollbackErr
			}
			for _, row := range pending {
				if _, err := tx.ExecContext(ctx, prefix+placeholder, row.arguments...); err != nil {
					if ctx.Err() != nil {
						return ctx.Err()
					}
					appendImportFailure(&result, row.index, row.raw, err)
				} else {
					mark(row)
				}
			}
		}
		pending = pending[:0]
		pendingIDs, pendingOrders = map[string]bool{}, map[string]bool{}
		return nil
	}
	for index, raw := range items {
		payload, err := decodeObjectPayload(raw)
		if err != nil {
			appendImportFailure(&result, index, raw, err)
			continue
		}
		id, _, idErr := nullablePayloadString(payload, "id")
		sourceID, _, sourceErr := nullablePayloadString(payload, "sourceId")
		orderID, _, orderErr := nullablePayloadString(payload, "orderId")
		for _, cause := range []error{idErr, sourceErr, orderErr} {
			if cause != nil {
				err = cause
				break
			}
		}
		if err != nil {
			appendImportFailure(&result, index, raw, err)
			continue
		}
		if pendingIDs[id] || (sourceID != "" && pendingIDs[sourceID]) || (strings.TrimSpace(orderID) != "" && pendingOrders[orderID]) {
			// A previous invalid row must not reserve an ID/order and suppress a
			// later valid row. Only confirmed writes participate in deduplication.
			if err := flush(); err != nil {
				return ledger.ImportResult{}, err
			}
		}
		if ids[id] || (sourceID != "" && ids[sourceID]) || (strings.TrimSpace(orderID) != "" && orders[orderID]) {
			result.Skipped++
			continue
		}
		normalizeTransactionPayload(payload, accountID, userID)
		row := preparedImportRow{index: index, raw: raw, id: id, orderID: orderID, arguments: make([]interface{}, 0, len(fields))}
		for _, field := range fields {
			value, cause := payloadValue(payload, field)
			if cause != nil {
				err = cause
				break
			}
			row.arguments = append(row.arguments, value)
		}
		if err != nil {
			appendImportFailure(&result, index, raw, err)
			continue
		}
		kind, _, _ := nullablePayloadString(payload, "type")
		_, hasLoan, _ := nullablePayloadString(payload, "loanId")
		if kind == "REPAYMENT" && hasLoan {
			if err := flush(); err != nil {
				return ledger.ImportResult{}, err
			}
			if _, err := tx.ExecContext(ctx, "SAVEPOINT import_loan"); err != nil {
				return ledger.ImportResult{}, err
			}
			err = validateLoanRepayment(ctx, tx, payload, accountID, userID)
			if err == nil {
				_, err = tx.ExecContext(ctx, prefix+placeholder, row.arguments...)
			}
			var repaymentAmount float64
			if err == nil {
				amount, cause := applyImportedLoanRepayment(ctx, tx, payload, accountID, userID)
				err = cause
				if err == nil {
					repaymentAmount = ratFloat64(amount)
				}
			}
			if err != nil {
				if _, cause := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT import_loan"); cause != nil {
					return ledger.ImportResult{}, cause
				}
				appendImportFailure(&result, index, raw, err)
				continue
			}
			mark(row)
			if repaymentAmount > 0 {
				result.LoanRepayments++
				result.LoanRepaymentAmount += repaymentAmount
			}
			continue
		}
		pending = append(pending, row)
		pendingIDs[id] = true
		if strings.TrimSpace(orderID) != "" {
			pendingOrders[orderID] = true
		}
		if len(pending) == importSQLBatchSize {
			if err := flush(); err != nil {
				return ledger.ImportResult{}, err
			}
		}
	}
	if err := flush(); err != nil {
		return ledger.ImportResult{}, err
	}
	sort.SliceStable(result.FailedRows, func(i, j int) bool { return result.FailedRows[i].LineNumber < result.FailedRows[j].LineNumber })
	if err := tx.Commit(); err != nil {
		return ledger.ImportResult{}, err
	}
	return result, nil
}

// Query only identifiers that this request could collide with; never load all
// historical rows again for each HTTP batch. Keep account isolation in SQL.
func transactionIdentifiersForImport(ctx context.Context, tx *sql.Tx, accountID string, items []json.RawMessage) (map[string]bool, map[string]bool, error) {
	candidateIDs, candidateOrders := map[string]bool{}, map[string]bool{}
	for _, raw := range items {
		payload, err := decodeObjectPayload(raw)
		if err != nil {
			continue
		}
		for _, key := range []string{"id", "sourceId"} {
			value, present, err := nullablePayloadString(payload, key)
			if err == nil && present {
				candidateIDs[value] = true
			}
		}
		if value, present, err := nullablePayloadString(payload, "orderId"); err == nil && present && strings.TrimSpace(value) != "" {
			candidateOrders[value] = true
		}
	}
	ids, orders := map[string]bool{}, map[string]bool{}
	predicates := []string{}
	arguments := []interface{}{accountID}
	for index, values := range []map[string]bool{candidateIDs, candidateOrders} {
		if len(values) == 0 {
			continue
		}
		column := "id"
		if index == 1 {
			column = "orderId"
		}
		predicates = append(predicates, "`"+column+"` IN ("+strings.TrimRight(strings.Repeat("?,", len(values)), ",")+")")
		for value := range values {
			arguments = append(arguments, value)
		}
	}
	if len(predicates) == 0 {
		return ids, orders, nil
	}
	rows, err := tx.QueryContext(ctx, "SELECT `id`,`orderId` FROM `transaction` WHERE `accountId`=? AND ("+strings.Join(predicates, " OR ")+")", arguments...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var order sql.NullString
		if err := rows.Scan(&id, &order); err != nil {
			return nil, nil, err
		}
		ids[id] = true
		if order.Valid {
			orders[order.String] = true
		}
	}
	return ids, orders, rows.Err()
}
