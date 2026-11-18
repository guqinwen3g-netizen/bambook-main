/**
 * 对客户的常用付款条件及其合同收款口径，以及报价条款到订单合同的承接。
 * 订单录入（前端 runtime/tradeOptions）与报价转单共用同一份映射。
 */
import { orderIncoterm } from './orderTradeTerms';
import type { OrderGovernanceInput } from './mistOrderGovernance';
import {isCalendarDay,shiftCalendarDay} from './mistBusinessClock';

type DeliveryAcceptanceTerms={kind:'deliveryAcceptance';days:number;terms:string};
export type ReceivableDueCondition=DeliveryAcceptanceTerms|{kind:'letterOfCredit';terms:string};
/** Explicit customer delivery acceptance is a separate fact from scheduled dispatch or POD. */
export function receivableAcceptanceTerms(value:string|undefined):DeliveryAcceptanceTerms|null{
  const terms=(value||'').trim();
  const normalized=terms.normalize('NFKC');
  const match=normalized.match(/(?:交付|客户)\s*验收(?:合格|完成)?后\s*(\d+)\s*天/)||normalized.match(/(\d+)\s*days?\s*(?:after|from)\s*(?:delivery|goods)\s+acceptance/i);
  if(!match)return null;
  const days=Number(match[1]);return Number.isSafeInteger(days)&&days>=0?{kind:'deliveryAcceptance',days,terms}:null;
}
export function shipmentReceivableDueCondition(contract:Pick<OrderGovernanceInput,'paymentMethod'|'paymentNote'>|undefined):ReceivableDueCondition|null{
  if(contract?.paymentMethod==='LC')return {kind:'letterOfCredit',terms:'按信用证条款付款，具体日期待银行确认'};
  return receivableAcceptanceTerms(contract?.paymentNote);
}
export function fixedShipmentReceivableDueProblem(condition:ReceivableDueCondition):string{
  return condition.kind==='letterOfCredit'?'信用证付款日期以银行依据为准，不能在CI预设固定日期':'本合同按客户验收确定到期日，不能预设固定日期';
}
export function dueAfterAcceptance(day:string,days:number):string{
  if(!isCalendarDay(day)||!Number.isSafeInteger(days)||days<0)return '';
  try{const due=shiftCalendarDay(day,days);return isCalendarDay(due)?due:'';}catch{return '';}
}

export type PaymentMethod = OrderGovernanceInput['paymentMethod'];
export type CustomerPaymentTerm = { value: string; method: PaymentMethod; deposit?: number; preShipment?: number };
const term = (value: string, method: PaymentMethod, deposit?: number, preShipment?: number): CustomerPaymentTerm =>
  ({ value, method, ...(deposit === undefined ? {} : { deposit }), ...(preShipment === undefined ? {} : { preShipment }) });

/** 对客户（出口销售）的常用付款条件；deposit 为定金比例，preShipment 为出运前累计收款比例。 */
export const CUSTOMER_PAYMENT_TERMS: CustomerPaymentTerm[] = [
  term('T/T 100% 预付', 'TT', 100, 100),
  term('T/T 30% 定金，70% 发货前付清', 'TT', 30, 100),
  term('T/T 30% 定金，70% 见提单副本', 'TT', 30, 30),
  term('T/T 50% 定金，50% 发货前付清', 'TT', 50, 100),
  term('T/T 50% 定金，50% 见提单副本', 'TT', 50, 50),
  term('T/T 发货前付清', 'TT', 0, 100),
  term('T/T 见提单副本', 'TT', 0, 0),
  term('T/T 提单日后 30 天', 'TT', 0, 0),
  term('T/T 提单日后 60 天', 'TT', 0, 0),
  term('L/C 即期', 'LC'),
  term('L/C 远期 30 天', 'LC'), term('L/C 远期 60 天', 'LC'), term('L/C 远期 90 天', 'LC'),
  term('D/P 即期', 'OTHER'),
  term('D/A 30 天', 'OTHER'), term('D/A 60 天', 'OTHER'), term('D/A 90 天', 'OTHER'),
  term('O/A 30 天', 'OA'), term('O/A 60 天', 'OA'), term('O/A 90 天', 'OA'),
];
export const customerPaymentTerm = (value: string) => CUSTOMER_PAYMENT_TERMS.find(option => option.value === value.trim());

export type PaymentTermContract = Pick<OrderGovernanceInput, 'paymentNote'> & Partial<Pick<OrderGovernanceInput, 'paymentMethod' | 'depositPercent' | 'preShipmentPercent'>>;
/** 常用条款带出付款方式、定金与出运前比例；其他写法只记原文，由人工核对收款口径。 */
export function paymentTermContract(value: string): PaymentTermContract {
  const found = customerPaymentTerm(value);
  return found ? { paymentNote: value, paymentMethod: found.method, depositPercent: found.deposit ?? 0, preShipmentPercent: found.method === 'TT' ? found.preShipment ?? null : null } : { paymentNote: value };
}

/** 报价的贸易术语（如 FOB 上海）与付款条件，作为转单后订单合同的初稿。 */
export function quotationContract(quote: { deliveryTerms?: string; paymentTerms?: string }): Partial<OrderGovernanceInput> {
  const terms = (quote.deliveryTerms || '').trim(), code = orderIncoterm(terms);
  const place = code ? terms.slice(code.length).replace(/^[\s,，.]+/, '').trim() : '';
  return { ...(code ? { incoterm: code, deliveryPlace: place } : terms ? { incoterm: terms } : {}), ...(quote.paymentTerms?.trim() ? paymentTermContract(quote.paymentTerms.trim()) : {}) };
}

/** 按客户付款条件推算出运应收的建议到期日：发货前 / 预付类以计划出运日为限，见提单 / 即期以 ETD 为准，明确的「N 天 / N days」在 ETD 后顺延 N 天。仅作预填，业务可改。 */
export function suggestedReceivableDue(paymentNote: string | undefined, shipDate: string | undefined): string {
  if(/(?:交付|客户)\s*验收|(?:delivery|goods)\s+acceptance/i.test(paymentNote||''))return '';
  if (!isCalendarDay(shipDate)) return '';
  const days = Number((paymentNote || '').match(/(\d+)\s*(?:天|days?\b)/i)?.[1] || 0);
  if (!days) return shipDate;
  const [y, m, d] = shipDate.split('-').map(Number), at = new Date(Date.UTC(y, m - 1, d + days)), pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}
