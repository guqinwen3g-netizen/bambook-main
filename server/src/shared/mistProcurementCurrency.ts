/** Current procurement policy shared by the form and typed API; never infer an unknown country. */
export const isDomesticSupplier = (supplier: { country?: string }) =>
  /^(中国|中国大陆|China|CN|PRC)$/i.test((supplier.country || '').trim());

export function procurementCurrencyProblem(supplier: { name: string; country?: string }, currency: string): string {
  return isDomesticSupplier(supplier) && currency.trim().toUpperCase() !== 'CNY'
    ? `${supplier.name} 是境内供应商，采购合同须以人民币（CNY）计价结算`
    : '';
}
