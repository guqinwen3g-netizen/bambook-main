import { expect, it } from 'vitest';
import { KNOWN_INCOTERMS } from '../../../../server/src/_shared/incoterm';
import { QUOTE_UNITS } from '../../../../server/src/shared/mistMarket';
import { CURRENCIES, CUSTOMER_PAYMENT_TERMS, EXPORT_REBATE_RATES, INCOTERMS, UNITS, joinIncoterm, paymentTermPatch, seasonOptions, splitIncoterm, withCurrent } from './tradeOptions';

it('offers the Incoterms 2020 codes the server recognises', () => {
  expect(INCOTERMS.map(option => option.value)).toEqual(['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']);
  for (const option of INCOTERMS) expect(KNOWN_INCOTERMS).toContain(option.value);
});

it('splits and joins a term with its named place', () => {
  expect(splitIncoterm('FOB 上海')).toEqual({ code: 'FOB', place: '上海' });
  expect(splitIncoterm('cif, Hamburg')).toEqual({ code: 'CIF', place: 'Hamburg' });
  expect(splitIncoterm('FOB')).toEqual({ code: 'FOB', place: '' });
  expect(splitIncoterm('按合同')).toEqual({ code: '', place: '按合同' });
  // 末尾空格保留，地点才能继续输入
  expect(splitIncoterm('FOB 上海 ')).toEqual({ code: 'FOB', place: '上海 ' });
  expect(joinIncoterm('FOB', '上海')).toBe('FOB 上海');
  expect(joinIncoterm('FOB', '')).toBe('FOB');
  expect(joinIncoterm('', '上海')).toBe('上海');
});

it('maps preset payment terms to contract fields the server accepts', () => {
  for (const term of CUSTOMER_PAYMENT_TERMS) {
    const patch = paymentTermPatch(term.value);
    expect(['TT', 'LC', 'OA', 'OTHER']).toContain(patch.paymentMethod);
    expect(patch.depositPercent).toBeGreaterThanOrEqual(0);
    if (patch.paymentMethod === 'TT') expect(patch.preShipmentPercent).toBeGreaterThanOrEqual(patch.depositPercent!);
    else expect(patch.preShipmentPercent).toBeNull();
  }
  expect(paymentTermPatch('T/T 30% 定金，70% 见提单副本')).toEqual({ paymentNote: 'T/T 30% 定金，70% 见提单副本', paymentMethod: 'TT', depositPercent: 30, preShipmentPercent: 30 });
  expect(paymentTermPatch('L/C 即期')).toMatchObject({ paymentMethod: 'LC', depositPercent: 0, preShipmentPercent: null });
  // 手动填写的条款只改原文，不猜付款方式
  expect(paymentTermPatch('客户自定条款')).toEqual({ paymentNote: '客户自定条款' });
});

it('merges company seasons with standard SS / AW codes in date order', () => {
  const options = seasonOptions(2026, [{ code: 'AW27', name: '2027 秋冬' }, { code: 'SS27' }]);
  expect(options.map(option => option.value)).toEqual(['SS26', 'AW26', 'SS27', 'AW27', 'SS28', 'AW28']);
  expect(options[3].label).toBe('AW27 · 2027 秋冬');
});

it('keeps an existing value that is not a preset', () => {
  expect(withCurrent(CURRENCIES, 'USD')).toBe(CURRENCIES);
  expect(withCurrent(CURRENCIES, 'RUB').at(-1)).toEqual({ value: 'RUB', label: 'RUB' });
  expect(withCurrent(CURRENCIES, '')).toBe(CURRENCIES);
});

it('uses codes and spellings that downstream rules compare exactly', () => {
  for (const option of CURRENCIES) expect(option.value).toMatch(/^[A-Z]{3}$/);
  for (const unit of [...QUOTE_UNITS.fabric, ...QUOTE_UNITS.garment]) expect(UNITS.map(option => option.value)).toContain(unit);
  for (const option of EXPORT_REBATE_RATES) expect(option.value).toMatch(/^\d{1,2}$/);
});
