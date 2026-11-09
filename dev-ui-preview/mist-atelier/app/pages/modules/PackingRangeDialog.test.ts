import { expect, it } from 'vitest';
import { expandCartonRange, parseRollPacking } from './PackingRangeDialog';

it('expands a carton range keeping prefix and zero padding', () => {
  const rows = expandCartonRange({ from: 'C001', to: 'C050', quantity: 24, netWeight: 8.5, grossWeight: 9.2, volume: 0.06 }, { lineId: 'l', productionId: 'p' });
  expect(rows).toHaveLength(50);
  expect(rows[0]).toEqual({ lineId: 'l', productionId: 'p', carton: 'C001', quantity: 24, netWeight: 8.5, grossWeight: 9.2, volume: 0.06, note: '' });
  expect(rows.at(-1)!.carton).toBe('C050');
  expect(() => expandCartonRange({ from: 'A1', to: 'B3', quantity: 1, netWeight: 1, grossWeight: 1, volume: 0 }, { lineId: 'l' })).toThrow('同一前缀');
  expect(() => expandCartonRange({ from: '5', to: '1', quantity: 1, netWeight: 1, grossWeight: 1, volume: 0 }, { lineId: 'l' })).toThrow('不能小于');
  expect(() => expandCartonRange({ from: '1', to: '3', quantity: 1, netWeight: 0, grossWeight: 0, volume: 0 }, { lineId: 'l' })).toThrow('净重须大于零');
  expect(() => expandCartonRange({ from: '1', to: '2', quantity: 1, netWeight: 2, grossWeight: 1, volume: 0 }, { lineId: 'l' })).toThrow('毛重');
});
it('parses a fabric roll packing list', () => {
  const rows = parseRollPacking('R1 120.5 30 31\nR2\t100,25,26,0.2\n', { lineId: 'l' });
  expect(rows.map(r => [r.carton, r.quantity, r.netWeight, r.grossWeight, r.volume])).toEqual([['R1', 120.5, 30, 31, 0], ['R2', 100, 25, 26, 0.2]]);
  expect(() => parseRollPacking('R1 10 1 1\nR1 5 1 1', { lineId: 'l' })).toThrow('重复');
  expect(() => parseRollPacking('R1 x', { lineId: 'l' })).toThrow('第 1 行');
  expect(() => parseRollPacking('R1 50', { lineId: 'l' })).toThrow('第 1 行缺少净重');
  expect(() => parseRollPacking('R1 50 0 0', { lineId: 'l' })).toThrow('第 1 行缺少净重');
});
