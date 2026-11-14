package ledger

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type SavingsFundInput struct {
	ID           string  `json:"id"`
	Kind         string  `json:"kind"`
	AmountCents  int64   `json:"amountCents"`
	Date         string  `json:"date"`
	Note         string  `json:"note"`
	WithdrawalID *string `json:"withdrawalId"`
}
type SavingsFundAllocation struct {
	PlanID *string `json:"planId"`
	Month  *string `json:"month"`
	Cents  int64   `json:"cents"`
}
type SavingsFundEntry struct {
	SavingsFundInput
	Allocations []SavingsFundAllocation `json:"allocations"`
	CreatedAt   string                  `json:"createdAt"`
}
type SavingsFundPlan struct {
	ID, Month string
	Cents     int64
}
type SavingsFundRepository interface {
	RecordSavingsFundMovement(context.Context, string, string, SavingsFundInput, string) (json.RawMessage, error)
}

func fundError(message string) error { return &Error{Status: 400, Message: message} }
func DecodeSavingsFunds(value string) ([]SavingsFundEntry, error) {
	entries := []SavingsFundEntry{}
	if value != "" {
		if err := json.Unmarshal([]byte(value), &entries); err != nil {
			return nil, fundError("储蓄资金记录无效，请刷新后重试。")
		}
	}
	for _, entry := range entries {
		var total int64
		for _, part := range entry.Allocations {
			if part.Cents <= 0 {
				return nil, fundError("储蓄资金记录无效。")
			}
			total += part.Cents
		}
		if entry.ID == "" || (entry.Kind != "WITHDRAWAL" && entry.Kind != "REPLENISHMENT") || entry.AmountCents <= 0 || total != entry.AmountCents {
			return nil, fundError("储蓄资金记录无效。")
		}
	}
	return entries, nil
}
func sameSource(a, b *string) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }
func SavingsSourceUsed(entries []SavingsFundEntry, source *string) int64 {
	var total int64
	for _, entry := range entries {
		sign := int64(1)
		if entry.Kind == "REPLENISHMENT" {
			sign = -1
		}
		for _, part := range entry.Allocations {
			if sameSource(part.PlanID, source) {
				total += sign * part.Cents
			}
		}
	}
	return total
}
func SavingsOutstanding(entries []SavingsFundEntry) int64 {
	var total int64
	for _, entry := range entries {
		if entry.Kind == "WITHDRAWAL" {
			total += entry.AmountCents
		} else {
			total -= entry.AmountCents
		}
	}
	return total
}
func ValidateSavingsBasis(entries []SavingsFundEntry, gross, recorded int64) error {
	if maxFund(gross, recorded) < SavingsOutstanding(entries) {
		return fundError("已存金额低于未补齐取用，请先补齐后再修改存款。")
	}
	legacy := SavingsSourceUsed(entries, nil)
	if legacy > 0 && gross-recorded < legacy {
		return fundError("期初储蓄还有未补齐取用，请先补齐后再减少存款。")
	}
	return nil
}
func AppendSavingsFund(entries []SavingsFundEntry, gross int64, plans []SavingsFundPlan, input SavingsFundInput, now string) ([]SavingsFundEntry, error) {
	if strings.TrimSpace(input.ID) == "" || len(input.ID) > 191 || (input.Kind != "WITHDRAWAL" && input.Kind != "REPLENISHMENT") || input.AmountCents <= 0 || input.AmountCents > 1_000_000_000_000 || utf8.RuneCountInString(input.Note) > 500 {
		return nil, fundError("请核对金额、时间和备注。")
	}
	layout := "2006-01-02T15:04"
	if len(input.Date) == 19 {
		layout += ":05"
	}
	if _, err := time.Parse(layout, input.Date); err != nil {
		return nil, fundError("请填写有效日期和时间。")
	}
	for _, entry := range entries {
		if entry.ID == input.ID {
			if !reflect.DeepEqual(entry.SavingsFundInput, input) {
				return nil, fundError("这笔操作已保存，请刷新核对记录。")
			}
			return entries, nil
		}
	}
	sources := []SavingsFundAllocation{}
	if input.Kind == "WITHDRAWAL" {
		if input.WithdrawalID != nil {
			return nil, fundError("取用记录不能关联另一笔取用。")
		}
		var recorded int64
		for _, plan := range plans {
			recorded += plan.Cents
		}
		sources = append(sources, SavingsFundAllocation{Cents: maxFund(0, gross-recorded) - SavingsSourceUsed(entries, nil)})
		ordered := append([]SavingsFundPlan{}, plans...)
		sort.Slice(ordered, func(i, j int) bool {
			if ordered[i].Month == ordered[j].Month {
				return ordered[i].ID < ordered[j].ID
			}
			return ordered[i].Month < ordered[j].Month
		})
		for _, plan := range ordered {
			id, month := plan.ID, plan.Month
			sources = append(sources, SavingsFundAllocation{PlanID: &id, Month: &month, Cents: maxFund(0, plan.Cents-SavingsSourceUsed(entries, &id))})
		}
	} else {
		var withdrawal *SavingsFundEntry
		for i := range entries {
			if entries[i].Kind == "WITHDRAWAL" && input.WithdrawalID != nil && entries[i].ID == *input.WithdrawalID {
				withdrawal = &entries[i]
				break
			}
		}
		if withdrawal == nil {
			return nil, fundError("找不到对应的取用记录，请刷新后重试。")
		}
		for _, part := range withdrawal.Allocations {
			for _, entry := range entries {
				if entry.Kind == "REPLENISHMENT" && entry.WithdrawalID != nil && *entry.WithdrawalID == withdrawal.ID {
					for _, restored := range entry.Allocations {
						if sameSource(part.PlanID, restored.PlanID) {
							part.Cents -= restored.Cents
						}
					}
				}
			}
			sources = append(sources, part)
		}
	}
	remaining := input.AmountCents
	allocated := []SavingsFundAllocation{}
	for _, source := range sources {
		if source.Cents <= 0 {
			continue
		}
		source.Cents = minFund(remaining, source.Cents)
		if source.Cents > 0 {
			allocated = append(allocated, source)
			remaining -= source.Cents
		}
	}
	if remaining > 0 {
		if input.Kind == "WITHDRAWAL" {
			return nil, fundError("取用金额不能超过当前储蓄余额。")
		}
		return nil, fundError("补齐金额不能超过这笔取用的待补齐金额。")
	}
	return append(entries, SavingsFundEntry{SavingsFundInput: input, Allocations: allocated, CreatedAt: now}), nil
}
func (service *Service) RecordSavingsFundMovement(ctx context.Context, userID, goalID string, input SavingsFundInput) (json.RawMessage, *Error) {
	if unavailable := service.available(); unavailable != nil {
		return nil, unavailable
	}
	repo, ok := service.repository.(SavingsFundRepository)
	if !ok {
		return nil, &Error{Status: 503, Message: "当前服务暂不支持储蓄取用，请更新服务端。"}
	}
	result, err := repo.RecordSavingsFundMovement(ctx, userID, goalID, input, service.now().Format("2006-01-02 15:04:05"))
	if err != nil {
		return nil, databaseError(err)
	}
	return result, nil
}

func maxFund(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
func minFund(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

type SavingsDepositInput struct {
	AmountCents       int64   `json:"amountCents"`
	Date              string  `json:"date"`
	ProofImage        *string `json:"proofImage"`
	ExpectedUpdatedAt string  `json:"expectedUpdatedAt"`
}
type SavingsDepositRepository interface {
	RecordSavingsDeposit(context.Context, string, string, SavingsDepositInput, string) error
}

func (service *Service) RecordSavingsDeposit(ctx context.Context, userID, planID string, input SavingsDepositInput) *Error {
	if unavailable := service.available(); unavailable != nil {
		return unavailable
	}
	repo, ok := service.repository.(SavingsDepositRepository)
	if !ok {
		return &Error{Status: 503, Message: "请更新服务端后再记录存款。"}
	}
	if err := repo.RecordSavingsDeposit(ctx, userID, planID, input, service.now().Format("2006-01-02 15:04:05")); err != nil {
		return databaseError(err)
	}
	return nil
}
