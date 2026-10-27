import type { MistReceipt, MistAllocation } from '../../../../server/src/shared/mistWorkspace';
import type { OrderFundingAssignment } from '../../../../server/src/shared/mistOrderFunding';

export const RECEIPT_STATE = { unmatched: { tone: 'bad' as const, label: '未认领' }, suggested: { tone: 'ai' as const, label: '匹配建议' }, matched: { tone: 'ok' as const, label: '已核销' } };
export function financeReceiptDisplay(receipt:MistReceipt,funding:readonly OrderFundingAssignment[],allocations:readonly Pick<MistAllocation,'receiptId'|'amount'>[]){
  const allocated=receipt.remaining<receipt.amount||allocations.some(row=>row.receiptId===receipt.id&&row.amount>0);
  const attributed=funding.some(row=>row.receiptId===receipt.id&&row.state==='active'&&row.amount>0);
  if(receipt.remaining===0)return {...RECEIPT_STATE.matched,unclaimed:false};
  if(allocated)return {tone:'warn' as const,label:'部分核销',unclaimed:false};
  if(attributed)return {tone:'accent' as const,label:'已归属待核销',unclaimed:false};
  return {...RECEIPT_STATE[receipt.state],unclaimed:receipt.state==='unmatched'&&receipt.remaining>0};
}
