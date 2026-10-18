import { describe, expect, it } from 'vitest';
import { parseImportTable } from './BaseDataImport';

describe('基础资料导入解析', () => {
  it('按表头对应字段，忽略未知列，跳过空行并保留原行号，日期转 YYYY-MM-DD', () => {
    const parsed = parseImportTable('customer', [
      ['客户名称*', '结算币种*', '合作起始日', '备注栏'],
      ['Nordic', 'USD', new Date(2023, 2, 1), 'x'],
      ['', '', '', ''],
      ['博远', 'CNY', '', ''],
    ], 'a.xlsx');
    expect(parsed.ignored).toEqual(['备注栏']);
    expect(parsed.missing).toEqual([]);
    expect(parsed.rows).toEqual([{ name: 'Nordic', currency: 'USD', since: '2023-03-01', __row: '2' }, { name: '博远', currency: 'CNY', since: '', __row: '4' }]);
  });
  it('缺少必填列时列出', () => {
    expect(parseImportTable('supplier', [['供应商名称'], ['甲']]).missing).toEqual(['供应商编码', '供应商类型', '生产能力', '月产能', '产能单位', '交付周期天']);
  });
});
