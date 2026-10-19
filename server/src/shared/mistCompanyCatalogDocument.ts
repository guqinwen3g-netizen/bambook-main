import { PRODUCT_SPEC_FIELDS, type MarketProduct } from './mistMarket';
import { companyProductRequirements, MIST_COMPANY_CATALOG_REVISION } from './mistCompanyCatalog';
import { MIST_COMPANY_IDENTITY } from './mistCompanyIdentity';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

function technicalTargets(product: MarketProduct): string {
  if (product.category === 'fabric') return '<h2>打样技术约定 · 下单前签认</h2><table><tr><th>克重控制</th><td>以登记克重为目标，允差 ±5%；每批取样实测。</td></tr><tr><th>门幅控制</th><td>以登记门幅为目标，允差 ±2 cm；有效幅宽另行确认。</td></tr><tr><th>颜色与整理</th><td>对照签认色样核对 D65 / TL84 光源色差；功能整理须另附相应检测报告。</td></tr></table>';
  if (product.category === 'trimming') return '<h2>打样技术约定 · 下单前签认</h2><table><tr><th>尺寸复核</th><td>按登记规格测量；拉链核有效长度与开尾结构，纽扣核外径，织带核幅宽。</td></tr><tr><th>配套确认</th><td>与主面料完成试缝、洗后外观及功能核对，试用结果随样品归档。</td></tr></table>';
  const category = product.specs?.garmentCategory || '';
  const numeric = /西装/.test(category), vest = /马甲/.test(category), coat = /大衣/.test(category), shirt = /衬衫/.test(category);
  const sizes = product.specs?.sizeRange === 'M' ? ['M'] : numeric
    ? (product.specs?.sizeRange === '44–54' ? ['44','46','48','50','52','54'] : ['44','46','48','50','52','54','56'])
    : product.specs?.sizeRange === 'XS–XL' ? ['XS','S','M','L','XL'] : ['S','M','L','XL','XXL'];
  const rows = sizes.map((size, index) => {
    const n = sizes.length === 1 ? 2 : index;
    const chest = (numeric ? 49 : coat ? 52 : vest ? 52 : 56) + n * 2;
    const length = (numeric ? 70 : coat ? 108 : vest ? 64 : shirt ? 72 : 68) + n * (numeric || coat ? 1 : 2);
    const shoulder = (numeric ? 42 : coat ? 43 : vest ? 40 : 46) + n;
    const sleeve = vest ? '—' : String((numeric ? 60 : coat ? 59 : 63) + n);
    return `<tr><td>${size}</td><td>${chest}</td><td>${length}</td><td>${shoulder}</td><td>${sleeve}</td></tr>`;
  }).join('');
  return `<section style="break-inside:avoid"><h2>版型开发目标 · 成衣平铺净尺寸 / cm</h2><table><tr><th>尺码</th><th>半胸围</th><th>后中衣长</th><th>肩宽</th><th>袖长</th></tr>${rows}</table><p class="meta">开发起版基准，须经试身及客户签认后转为订单尺寸表；一般部位目标公差 ±1 cm，关键部位按签认版执行。半胸围平铺测量，衣长自后领接缝至下摆，袖长自肩缝至袖口。</p></section>`;
}

/** Versioned product facts and blank inspection record, never a fabricated certificate/result. */
export function companyCatalogDocument(product: MarketProduct, supplier: string, kind: 'specification' | 'inspection', imageDataUrl?: string): string {
  const title = kind === 'specification' ? '产品技术资料' : '来料与出货检验要求';
  const row = (label: string, value: unknown) => `<tr><th>${escape(label)}</th><td>${escape(value || '按订单确认')}</td></tr>`;
  const facts = [row('款号 / 名称', `${product.sku} · ${product.name}`), row('成分', product.composition), row('颜色', product.color), row('供应商 / 供应商编码', `${supplier} / ${product.supplierCode}`), row('季节 / 计价单位', `${product.season} / ${product.unit}`), ...PRODUCT_SPEC_FIELDS[product.category].map(field => row(field.label, `${product.specs?.[field.key] || '待签认'}${field.unit ? ' ' + field.unit : ''}`))].join('');
  const requirements = companyProductRequirements(product);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:12px/1.65 "PingFang SC","Noto Sans CJK SC",sans-serif;color:#233b39;margin:0}header{border-bottom:2px solid #567d72;padding-bottom:12px;margin-bottom:18px}header small{letter-spacing:2px;color:#67837b}h1{font-size:24px;margin:6px 0}h2{font-size:15px;margin:18px 0 8px}p{margin:6px 0}.meta{color:#657771}.hero{display:flex;gap:18px}.hero img{width:65mm;height:65mm;object-fit:contain;background:#f3f4ee}.hero table{flex:1}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #d5ded8;text-align:left;padding:6px 8px;vertical-align:top}th{background:#eff3ee;width:30%;font-weight:500}li{margin-bottom:7px}.note{background:#f3f5f0;padding:10px 12px}.blank td{height:32px}footer{margin-top:18px;border-top:1px solid #d5ded8;padding-top:8px;color:#72837d;font-size:10px}tr{break-inside:avoid}
    </style><header><small>MISTWEAVE · PRODUCT ARCHIVE</small><h1>${title}</h1><div>${escape(MIST_COMPANY_IDENTITY.legalName)}</div><div class="meta">${escape(product.sku)} / Rev. ${String(MIST_COMPANY_CATALOG_REVISION).padStart(2, '0')} / 2026-10-19</div></header>
    <div class="hero">${kind === 'specification' && imageDataUrl?.startsWith('data:image/') ? `<img src="${escape(imageDataUrl)}" alt="产品外观">` : ''}<table>${facts}</table></div>
    ${kind === 'specification' ? technicalTargets(product) : ''}
    <h2>${kind === 'specification' ? '开发与交付控制' : '检验项目与判定依据'}</h2><ol>${requirements.map(text => `<li>${escape(text)}</li>`).join('')}</ol>
    ${kind === 'inspection' ? `<h2>批次实测记录</h2><table class="blank"><tr><th>订单 / 批次</th><td></td><th>抽样数量</th><td></td></tr><tr><th>检验日期 / 人员</th><td></td><th>检验地点</th><td></td></tr><tr><th>尺寸 / 克重实测</th><td colspan="3"></td></tr><tr><th>外观 / 色差 / 功能</th><td colspan="3"></td></tr><tr><th>异常与复检</th><td colspan="3"></td></tr><tr><th>结果 / 放行依据</th><td colspan="3"></td></tr></table>` : `<h2>资料使用说明</h2><p>${escape(product.note || '询价、开发与复购时须核对客户要求；订单确认后以签认版本为准。')}</p>`}
    <p class="note">本资料记录档案规格与检验要求。订单专用尺寸表、色样、包装稿、认证及第三方检测报告须另行归档并关联相应订单；未附文件不代表已取得认证或已完成检验。</p>
    <footer>${escape(MIST_COMPANY_IDENTITY.englishName)} · ${escape(product.sku)} · ${kind === 'specification' ? 'Technical specification' : 'Inspection requirements & record'}</footer></html>`;
}
