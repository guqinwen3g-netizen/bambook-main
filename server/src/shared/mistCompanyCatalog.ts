import { PRODUCT_SPEC_FIELDS, type MarketProduct } from './mistMarket';

/** Fictional company catalog requirements. These are specifications, not test certificates. */
export const MIST_COMPANY_CATALOG_REVISION = 1;
const additions: Record<string, Partial<MarketProduct>> = {
  'FB-2702': { specs: { yarn: '75D/72F' } },
  'GA-2712': { specs: { style: 'MW-VT-2712' } },
  'GA-2711': { color: '浅石色' },
};

/** Fill omissions only: operational edits, prices, IDs and historical snapshots stay intact. */
export function completeCompanyProduct(product: MarketProduct): MarketProduct {
  const defaults = additions[product.sku];
  const specs = { ...defaults?.specs, ...product.specs };
  const summary = PRODUCT_SPEC_FIELDS[product.category].flatMap(field =>
    specs[field.key] ? [`${field.label} ${specs[field.key]}${field.unit ? ` ${field.unit}` : ''}`] : [],
  ).join('；');
  return { ...product, specs, color: product.color || defaults?.color || '', specification: product.specification || summary };
}

export function companyProductRequirements(product: MarketProduct): string[] {
  if (product.category === 'fabric') return [
    '颜色以客户签认色样为准；同缸留样，缸差及头中尾色差分别核对。',
    '每卷记录实测幅宽、克重、米数、缸号及疵点分布；报告须关联订单和批次。',
    '大货前确认缩水、色牢度、起球及功能整理测试方法和客户限值；本资料不替代检验报告。',
    '卷装防潮，卷头标明款号、色号、缸号、卷号与净米数；异常卷单独标识。',
  ];
  if (product.category === 'garment') return [
    '产前样、尺码表及工艺单须由客户确认；尺码配比以订单及核准生产计划为准。',
    '核对面辅料批次、裁片色差、对称性、缝制、熨烫及附件牢固度；问题关闭后记录复检。',
    '关键部位逐码实测并记录偏差；测量方法及公差以签认尺码表为准。',
    '主唛、洗标、吊牌及包装须与客户签认稿一致；箱号、尺码配比和净毛重与装箱单一致。',
  ];
  return [
    '尺寸、颜色及手感以签认样为准；批次、数量与供应商送货单逐项核对。',
    product.sku === 'TR-2801' ? '核对有效长度、上下拉头方向、开尾结构、拉合顺畅度及布带色差。' :
      product.sku === 'TR-2802' ? '洗标印稿需单独签认；成分、护理符号、原产地和语言按最终销售市场要求核对。' :
      product.sku === 'TR-2804' ? '核对织带幅宽、组织、长度及接头数；色差和缩水要求随主料确认。' :
      '核对表面处理、边缘毛刺、孔位或扣合结构；耐洗及拉力按客户要求送检。',
    '辅料与面料做配套试用，确认后方可投产；检验结果记录在对应批次报告中。',
    '按款号、颜色、规格及批次分包标识，保留签认样与进料记录。',
  ];
}
