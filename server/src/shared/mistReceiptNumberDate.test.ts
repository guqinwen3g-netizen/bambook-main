import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, type MistContext } from './mistWorkspace';

describe('receipt number business date',()=>{
 it.each([
  ['2026-10-29T16:30:00Z','2026-10-30','BR-20261030-001'],
  ['2026-12-31T16:30:00Z','2027-01-01','BR-20270101-001'],
 ])('numbers a newly recorded receipt using Shanghai date at %s',(now,date,code)=>{
  let n=0;const context:MistContext={id:()=>`receipt-${++n}`,now,actorId:'finance',actorName:'财务'};
  const state=createMistState(context,'empty');
  const out=applyMistCommand(state,{type:'finance.importReceipts',payload:{receipts:[{date,payer:'测试付款人',currency:'USD',amount:10,ref:'BANK-1'}]}},context).state;
  expect(out.receipts[0]).toMatchObject({code,date,amount:10});
 });
 it('does not use a backfilled transaction date for the new number or rewrite old receipt numbers',()=>{
  let n=0;const context:MistContext={id:()=>`receipt-${++n}`,now:'2026-10-29T16:30:00Z',actorId:'finance',actorName:'财务'};
  const state=createMistState(context,'empty');state.receipts.push({id:'old',code:'BR-LEGACY',date:'2026-09-01',payer:'原付款人',currency:'USD',amount:5,remaining:5,ref:'BANK-OLD',state:'unmatched'});
  const command={type:'finance.importReceipts' as const,payload:{receipts:[{date:'2026-09-30',payer:'测试付款人',currency:'USD',amount:10,ref:'BANK-NEW'}]}};
  const out=applyMistCommand(state,command,context).state;
  expect(out.receipts[0]).toEqual(state.receipts[0]);expect(out.receipts[1]).toMatchObject({code:'BR-20261030-002',date:'2026-09-30'});
  const again=applyMistCommand(out,command,context);expect(again.state.receipts).toEqual(out.receipts);expect(again.result).toMatchObject({imported:0,skipped:1});
 });
});
