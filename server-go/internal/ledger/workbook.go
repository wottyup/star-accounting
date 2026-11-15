package ledger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

type WorkbookRequest struct {
	Format        string                                      `json:"format"`
	SchemaVersion int                                         `json:"schemaVersion"`
	ImportID      string                                      `json:"importId"`
	Sheets        map[EntityType][]map[string]json.RawMessage `json:"sheets"`
}
type WorkbookResult struct {
	AccountID string `json:"accountId"`
	Imported  int    `json:"imported"`
	Reused    bool   `json:"reused"`
}
type WorkbookRepository interface {
	ImportWorkbook(context.Context, string, WorkbookRequest) (WorkbookResult, error)
}

var WorkbookEntities = []EntityType{Accounts, Loans, Assets, Budgets, SavingsGoals, SavingsPlans, Subscriptions, Transactions, CategoryRules, ImportErrorLogs, ExchangeRates, ThemeConfigs}
var workbookDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)

func workbookHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:40]
}
func workbookText(row map[string]json.RawMessage, key string) string {
	var v string
	_ = json.Unmarshal(row[key], &v)
	return v
}
func workbookPut(row map[string]json.RawMessage, key string, value interface{}) {
	row[key], _ = json.Marshal(value)
}

// PrepareWorkbook rejects broken relationships and binds every record to the authenticated user.
// All record IDs are in a new account namespace, including subscription-generated transactions.
func PrepareWorkbook(userID string, input WorkbookRequest) (map[EntityType][]map[string]json.RawMessage, string, error) {
	fail := func(message string) (map[EntityType][]map[string]json.RawMessage, string, error) {
		return nil, "", fundError(message)
	}
	if input.Format != "star-accounting-workbook" || input.SchemaVersion != 1 || !workbookDigest.MatchString(input.ImportID) || len(input.Sheets) != len(WorkbookEntities) {
		return fail("账本工作簿格式或版本不受支持")
	}
	accountID := "workbook-" + workbookHash(userID+"\x00"+input.ImportID)
	ids := map[EntityType]map[string]string{}
	rows := map[EntityType][]map[string]json.RawMessage{}
	total := 0
	for _, entity := range WorkbookEntities {
		source, ok := input.Sheets[entity]
		if !ok {
			return fail("工作表缺失：" + string(entity))
		}
		ids[entity] = map[string]string{}
		rows[entity] = make([]map[string]json.RawMessage, 0, len(source))
		for _, record := range source {
			id := workbookText(record, "id")
			if id == "" || len(id) > 191 || ids[entity][id] != "" {
				return fail("工作表记录 ID 缺失或重复：" + string(entity))
			}
			if len(record) > 100 {
				return fail("工作表字段过多")
			}
			clone := map[string]json.RawMessage{}
			for k, v := range record {
				if k == "__deleted" || k == "password" || k == "token" {
					return fail("工作表含不允许导入的字段")
				}
				clone[k] = v
			}
			next := "wb-" + workbookHash(accountID+"\x00"+string(entity)+"\x00"+id)
			if entity == Accounts {
				next = accountID
			}
			ids[entity][id] = next
			workbookPut(clone, "id", next)
			rows[entity] = append(rows[entity], clone)
			total++
		}
	}
	if len(rows[Accounts]) != 1 || len(rows[ThemeConfigs]) > 1 || total > 500000 {
		return fail("账本信息或记录数量无效")
	}
	originalAccount := workbookText(input.Sheets[Accounts][0], "id")
	planGoal := map[string]string{}
	for _, plan := range input.Sheets[SavingsPlans] {
		planGoal[workbookText(plan, "id")] = workbookText(plan, "goalId")
	}
	for _, entity := range WorkbookEntities {
		for i, row := range rows[entity] {
			original := input.Sheets[entity][i]
			if entity == Accounts {
				workbookPut(row, "ownerId", userID)
				workbookPut(row, "name", workbookText(row, "name")+"（导入）")
			} else if entity != ExchangeRates && entity != SavingsPlans {
				if entity != ThemeConfigs && workbookText(original, "accountId") != originalAccount {
					return fail("记录不属于导出账本：" + string(entity))
				}
				workbookPut(row, "accountId", accountID)
				workbookPut(row, "userId", userID)
			}
			if entity == SavingsPlans {
				goal := ids[SavingsGoals][workbookText(row, "goalId")]
				if goal == "" {
					return fail("储蓄计划关联的目标不存在")
				}
				workbookPut(row, "goalId", goal)
			}
			if entity == Transactions {
				loan := workbookText(row, "loanId")
				if loan != "" {
					next := ids[Loans][loan]
					if next == "" {
						return fail("账单关联的贷款不存在")
					}
					workbookPut(row, "loanId", next)
				}
				// Preserve the app's deterministic recurring IDs, so restoring cannot charge again.
				for old, next := range ids[Subscriptions] {
					prefix := "subscription-" + old + "-"
					id := workbookText(original, "id")
					if strings.HasPrefix(id, prefix) {
						workbookPut(row, "id", "subscription-"+next+"-"+strings.TrimPrefix(id, prefix))
					}
					order := workbookText(row, "orderId")
					if strings.HasPrefix(order, "subscription:"+old+":") {
						workbookPut(row, "orderId", "subscription:"+next+":"+strings.TrimPrefix(order, "subscription:"+old+":"))
					}
				}
			}
			if entity == SavingsGoals {
				entries, err := DecodeSavingsFunds(workbookText(row, "fundMovements"))
				if err != nil {
					return fail(err.Error())
				}
				seen := map[string]bool{}
				withdrawals := map[string]bool{}
				remaining := map[string]map[string]int64{}
				for _, entry := range entries {
					if seen[entry.ID] {
						return fail("储蓄资金操作 ID 重复")
					}
					seen[entry.ID] = true
					if entry.Kind == "WITHDRAWAL" {
						if entry.WithdrawalID != nil {
							return fail("取用记录不能关联另一笔取用。")
						}
						withdrawals[entry.ID] = true
						remaining[entry.ID] = map[string]int64{}
						for _, part := range entry.Allocations {
							source := ""
							if part.PlanID != nil {
								source = *part.PlanID
							}
							remaining[entry.ID][source] += part.Cents
						}
					}
				}
				for j := range entries {
					entry := &entries[j]
					if entry.Kind == "REPLENISHMENT" && (entry.WithdrawalID == nil || !withdrawals[*entry.WithdrawalID]) {
						return fail("储蓄补齐关联的取用不存在")
					}
					for k := range entry.Allocations {
						part := &entry.Allocations[k]
						if entry.Kind == "REPLENISHMENT" {
							source := ""
							if part.PlanID != nil {
								source = *part.PlanID
							}
							left := remaining[*entry.WithdrawalID][source] - part.Cents
							if left < 0 {
								return fail("储蓄补齐超过对应来源的取用金额")
							}
							remaining[*entry.WithdrawalID][source] = left
						}
						if part.PlanID != nil {
							if planGoal[*part.PlanID] != workbookText(original, "id") {
								return fail("储蓄资金分配关联了其他目标的计划")
							}
							next := ids[SavingsPlans][*part.PlanID]
							if next == "" {
								return fail("储蓄资金分配关联的计划不存在")
							}
							part.PlanID = &next
						}
					}
				}
				body, _ := json.Marshal(entries)
				workbookPut(row, "fundMovements", string(body))
			}
		}
	}
	return rows, accountID, nil
}
func (service *Service) ImportWorkbook(ctx context.Context, userID string, input WorkbookRequest) (WorkbookResult, *Error) {
	if err := service.available(); err != nil {
		return WorkbookResult{}, err
	}
	repository, ok := service.repository.(WorkbookRepository)
	if !ok {
		return WorkbookResult{}, &Error{Status: 501, Message: "当前服务尚不支持工作簿导入，请更新服务端"}
	}
	result, err := repository.ImportWorkbook(ctx, userID, input)
	if err != nil {
		var e *Error
		if value, ok := err.(*Error); ok {
			e = value
		} else {
			e = &Error{Status: 400, Message: fmt.Sprintf("工作簿导入失败，未写入数据：%v", err)}
		}
		return WorkbookResult{}, e
	}
	return result, nil
}
