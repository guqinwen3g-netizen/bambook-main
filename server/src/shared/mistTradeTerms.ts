/**
 * 对客户的常用付款条件及其合同收款口径，以及报价条款到订单合同的承接。
 * 订单录入（前端 runtime/tradeOptions）与报价转单共用同一份映射。
 */
import { orderIncoterm } from './orderTradeTerms';
import type { OrderGovernanceInput } from './mistOrderGovernance';

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
