import assert from "node:assert/strict";
import test from "node:test";
import { appendSavingsFundEntry, savingsFundEntries, savingsFundOutstanding, retainedSavingsPlanAmount, preserveSavingsFund, assertSavingsPlanFundChange, savingsFundCashflowPlans, savingsFundPeriodWithdrawals } from "./funds.ts";
import { summarizeSavingsGoalProgress } from "./progress.ts";
import { calculateCalendarPeriodCashflow } from "../dashboard/salary-cycle.ts";
const now = "2026-11-14 12:00:00";
const goal = { id:"g", accountId:"a", currentAmount:3500, targetAmount:11500 };
const plans = [ {id:"p1",goalId:"g",status:"COMPLETED",amount:2000,actualAmount:2000,month:"2026-09"}, {id:"p2",goalId:"g",status:"COMPLETED",amount:1500,actualAmount:1500,month:"2026-10"} ];
function input(id,amountCents,withdrawalId) { return { id, amountCents, kind:withdrawalId ? "REPLENISHMENT":"WITHDRAWAL",withdrawalId:withdrawalId??null, date:"2026-11-14T12:00",note:"test" }; }
function append(g,i,p=plans) { return appendSavingsFundEntry(g,p,i,now); }
test("withdrawal and partial replenishments reconcile balance and original-month progress",()=>{
 let g=append(goal,input("w",100000));
 assert.equal(summarizeSavingsGoalProgress(g,plans).savedAmount,2500);
 assert.equal(savingsFundOutstanding(g),1000);
 assert.equal(retainedSavingsPlanAmount(plans[0],g),1000);
 assert.equal(retainedSavingsPlanAmount(plans[1],g),1500);
 g=append(g,input("r1",40000,"w"));
 assert.equal(summarizeSavingsGoalProgress(g,plans).savedAmount,2900);
 assert.equal(savingsFundOutstanding(g),600);
 g=append(g,input("r2",60000,"w"));
 assert.equal(summarizeSavingsGoalProgress(g,plans).savedAmount,3500);
 assert.equal(savingsFundOutstanding(g),0);
 assert.equal(retainedSavingsPlanAmount(plans[0],g),2000);
 assert.equal(g.currentAmount,3500);
});
test("multiple sources and withdrawal-specific repayments restore only original allocations",()=>{
 let g=append({...goal,currentAmount:4000},input("w",270000));
 assert.deepEqual(savingsFundEntries(g)[0].allocations.map(p=>[p.planId,p.cents]),[[null,50000],["p1",200000],["p2",20000]]);
 g=append(g,input("w2",100000));
 g=append(g,input("r",70000,"w"));
 assert.equal(retainedSavingsPlanAmount(plans[0],g),200);
 assert.equal(retainedSavingsPlanAmount(plans[1],g),300);
 assert.equal(savingsFundOutstanding(g),3000);
 assert.throws(()=>append(g,input("over",200001,"w")),/不能超过/);
});
test("legacy-only savings and plan amounts above stale stored total remain withdrawable",()=>{
 assert.equal(savingsFundOutstanding(append(goal,input("w",350000),[])),3500);
 const g=append({...goal,currentAmount:0},input("w",350000));
 assert.equal(summarizeSavingsGoalProgress(g,plans).savedAmount,0);
});
test("reject overdraw, overpay, invalid date, duplicate changed request and keep retries idempotent",()=>{
 const request=input("w",100000),g=append(goal,request);
 assert.strictEqual(append(g,request),g);
 assert.throws(()=>append(goal,input("x",350001)),/不能超过/);
 assert.throws(()=>append(g,input("x",100001,"w")),/不能超过/);
 assert.throws(()=>append(g,input("w",100001)),/已保存/);
 assert.throws(()=>append(g,input("r",1,"missing")),/找不到/);
 for(const date of ["2026-02-31T12:00","2026-11-14T25:00","2026-11-14","2026-13-01T00:00"]) assert.throws(()=>append(goal,{...request,date}));
 for(const amountCents of [0,-1,1.1,Number.NaN,Number.POSITIVE_INFINITY]) assert.throws(()=>append(goal,{...request,amountCents}));
});
test("ordinary edits preserve ledger and protect outstanding sources",()=>{
 const g=append(goal,input("w",100000));
 assert.equal(preserveSavingsFund({...g,fundMovements:null},g,plans).fundMovements,g.fundMovements);
 assert.throws(()=>assertSavingsPlanFundChange(g,plans[0]),/未补齐/);
 assert.throws(()=>assertSavingsPlanFundChange(g,plans[0],{...plans[0],actualAmount:999}),/未补齐/);
 assert.throws(()=>assertSavingsPlanFundChange(g,plans[0],{...plans[0],month:"2026-11"}),/未补齐/);
 assert.doesNotThrow(()=>assertSavingsPlanFundChange(g,plans[0],{...plans[0],actualAmount:1200}));
 assert.doesNotThrow(()=>assertSavingsPlanFundChange(append(g,input("r",100000,"w")),plans[0]));
 const legacy=append({...goal,currentAmount:4000},input("w",10000));
 assert.throws(()=>preserveSavingsFund({...legacy,currentAmount:3500},legacy,plans),/期初/);
});
test("cent allocations stay exact and money transfers affect cashflow without a spending entry",()=>{
 const tinyPlans=[{...plans[0],amount:0.3,actualAmount:0.3}];
 let g=append({...goal,currentAmount:0.3},input("w",29),tinyPlans);
 assert.equal(retainedSavingsPlanAmount(tinyPlans[0],g),0.01);
 g=append(g,input("r",7,"w"),tinyPlans);
 assert.equal(retainedSavingsPlanAmount(tinyPlans[0],g),0.08);
 const transfers=savingsFundCashflowPlans([g]);
 assert.ok(Math.abs(transfers.reduce((s,p)=>s+p.actualAmount,0) + 0.22) < 1e-9);
 const cashflow=calculateCalendarPeriodCashflow([],transfers,"2026-11");
 assert.equal(cashflow.income,0);
 assert.equal(cashflow.expense,0);
 assert.ok(Math.abs(cashflow.savings+0.22)<1e-9);
});

test("home withdrawal breakdown follows month, year and payday without netting replenishments",()=>{
 let g=append(goal,{...input("oct",20000),date:"2026-10-31T12:00"});
 g=append(g,{...input("before-payday",30000),date:"2026-11-10T12:00"});
 g=append(g,{...input("after-payday",40000),date:"2026-11-20T12:00"});
 g=append(g,{...input("return",20000,"oct"),date:"2026-11-21T12:00"});
 const november=savingsFundPeriodWithdrawals([g],"2026-11",15,new Date(2026,10,25));
 assert.equal(november.monthSavingsWithdrawal,700);
 assert.equal(november.cycleSavingsWithdrawal,400);
 assert.equal(savingsFundPeriodWithdrawals([g],"2026-11",15,new Date(2026,10,14)).cycleSavingsWithdrawal,500);
 assert.equal(savingsFundPeriodWithdrawals([g],"2026",15,new Date(2026,10,25)).monthSavingsWithdrawal,900);
 assert.deepEqual(savingsFundPeriodWithdrawals([g],"2026-12",15,new Date(2026,11,25)),{monthSavingsWithdrawal:0,cycleSavingsWithdrawal:0});
 assert.deepEqual(savingsFundPeriodWithdrawals([goal],"2026-11",15,new Date(2026,10,25)),{monthSavingsWithdrawal:0,cycleSavingsWithdrawal:0});
 // Deposits + top-up minus withdrawals explain the same net savings used by balance.
 const cashflow=calculateCalendarPeriodCashflow([],savingsFundCashflowPlans([g]),"2026-11");
 assert.equal(cashflow.savings+november.monthSavingsWithdrawal,200);
 assert.equal(cashflow.balance,500);
});
