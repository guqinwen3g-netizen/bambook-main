import { describe, expect, it } from 'vitest';
import { nextBusinessCode, nextSerialCode } from '../mistBusinessClock';

describe('nextBusinessCode', () => {
  it('续最大序号，识别不同补零位数的旧号', () => {
    expect(nextBusinessCode('SO-G', ['SO-G-2026-009', 'SO-G-2026-018', 'SO-F-2026-0040'], '2026-11-09T02:00:00Z')).toBe('SO-G-2026-0019');
  });
  it('删除中间单据后不撞号', () => {
    expect(nextBusinessCode('PAY', ['PAY-2026-0001', 'PAY-2026-0003'], '2026-03-01T00:00:00Z')).toBe('PAY-2026-0004');
  });
  it('年份取上海业务日（UTC 跨年前夜已是新年）', () => {
    expect(nextBusinessCode('QT', ['QT-2026-0012'], '2026-12-31T17:00:00Z')).toBe('QT-2027-0001');
  });
  it('无年份编号与位宽', () => {
    expect(nextSerialCode('BA-', ['BA-002', 'BA-x', undefined], 3)).toBe('BA-003');
    expect(nextBusinessCode('GR', [], '2026-05-01T00:00:00Z', 5)).toBe('GR-2026-00001');
  });
});
