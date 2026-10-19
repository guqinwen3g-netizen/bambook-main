import { describe, expect, it } from 'vitest';
import { companyCatalogDocument } from './mistCompanyCatalogDocument';
import type { MarketProduct } from './mistMarket';

const product = { sku: 'FB-2801', name: '<script>bad</script>', category: 'fabric', composition: '羊毛 80%', color: '燕麦色', season: 'AW26', supplierCode: 'WL-01', unit: '米', specs: { weight: '560', width: '150', weave: '双面斜纹' } } as MarketProduct;
describe('company catalog attachments', () => {
  it('escapes business data and embeds only an image data URI', () => {
    const html = companyCatalogDocument(product, 'A&B', 'specification', 'https://untrusted.invalid/pixel');
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(html).toContain('A&amp;B');
    expect(html).not.toContain('<script>');expect(html).not.toContain('https://untrusted.invalid');
    expect(html).toContain('560 g/m²');expect(html).toContain('150 cm');
  });
  it('keeps inspection results blank and does not represent requirements as certificates', () => {
    const html = companyCatalogDocument(product, '供应商', 'inspection');
    expect(html).toContain('批次实测记录');expect(html).toContain('结果 / 放行依据');
    expect(html).toContain('未附文件不代表已取得认证或已完成检验');
    expect(html).not.toContain('检验通过');expect(html).not.toContain('模拟');
  });
  it('provides a size-specific development target without presenting it as a signed measurement record', () => {
    const html = companyCatalogDocument({ ...product, category: 'garment', specs: { garmentCategory: '西装', sizeRange: '44–54' } }, '供应商', 'specification');
    expect(html).toContain('版型开发目标');expect(html).toContain('<td>54</td>');expect(html).not.toContain('<td>56</td>');
    expect(html).toContain('须经试身及客户签认');expect(html).toContain('半胸围');
  });
});
