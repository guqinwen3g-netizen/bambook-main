/**
 * 外贸常用选项：贸易术语、付款条件、币种、国家地区、港口、单位等。
 * 只是录入时的常用值；保存的仍是文本或代码，服务端校验口径不变（贸易术语代码见 server/src/_shared/incoterm.ts）。
 */
import { CUSTOMER_PAYMENT_TERMS as SHARED_CUSTOMER_TERMS, paymentTermContract, type PaymentMethod as SharedPaymentMethod } from '../../../../server/src/shared/mistTradeTerms';

export type TradeOption = { value: string; label: string };

const plain = (values: string[]): TradeOption[] => values.map(value => ({ value, label: value }));

/** Incoterms 2020 全部 11 条。保存代码，指定地点另填。 */
export const INCOTERMS: TradeOption[] = [
  ['EXW', '工厂交货'], ['FCA', '货交承运人'], ['FAS', '船边交货'], ['FOB', '船上交货'],
  ['CFR', '成本加运费'], ['CIF', '成本、保险费加运费'], ['CPT', '运费付至'], ['CIP', '运费和保险费付至'],
  ['DAP', '目的地交货'], ['DPU', '卸货地交货'], ['DDP', '完税后交货'],
].map(([value, name]) => ({ value, label: `${value} ${name}` }));
const INCOTERM_CODES = INCOTERMS.map(option => option.value);

/** 内部交接没有国际贸易术语，按实际交接方式选。 */
export const INTERNAL_DELIVERY: TradeOption[] = plain(['内部交接', '送货到厂', '工厂自提', '物流配送']);

/** 「FOB 上海」→ { code: 'FOB', place: '上海' }；认不出代码时整段视为地点。 */
export function splitIncoterm(value: string): { code: string; place: string } {
  // 只去开头空白：录入地点时末尾的空格要保留，才能继续输入「上海 洋山」这类写法。
  const text = value.replace(/^\s+/, ''), code = INCOTERM_CODES.find(item => text.trim().toUpperCase() === item || new RegExp(`^${item}[\\s,，.]`, 'i').test(text));
  return code ? { code, place: text.slice(code.length).replace(/^[\s,，.]+/, '') } : { code: '', place: text };
}
export const joinIncoterm = (code: string, place: string) => code && place ? `${code} ${place}` : code || place;

/** 付款方式与合同字段的对应：常用条款及其收款口径与报价转单共用服务端同一份（mistTradeTerms）。 */
export type PaymentMethod = SharedPaymentMethod;
export const PAYMENT_METHODS: TradeOption[] = [{ value: 'TT', label: 'T/T 电汇' }, { value: 'LC', label: 'L/C 信用证' }, { value: 'OA', label: 'O/A 赊销' }, { value: 'OTHER', label: '其他（D/P、D/A 等）' }];
export const paymentMethodLabel = (value: string | undefined) => PAYMENT_METHODS.find(option => option.value === value)?.label || value || '';
/** 对客户（出口销售）的常用付款条件。 */
export const CUSTOMER_PAYMENT_TERMS: TradeOption[] = SHARED_CUSTOMER_TERMS.map(term => ({ value: term.value, label: term.value }));
/** 订单合同选了常用条款时，一并带出付款方式、定金与出运前累计收款；手动填写的条款只改原文。 */
export const paymentTermPatch = paymentTermContract;

/** 对供应商、加工厂（国内采购）的常用付款条件。 */
export const SUPPLIER_PAYMENT_TERMS: TradeOption[] = plain([
  '款到发货', '预付 30%，余款发货前付清', '预付 30%，余款到货验收后付清', '预付 50%，余款发货前付清',
  '货到付款', '到货验收合格后付款', '票到 30 天付款', '票到 60 天付款',
  '月结 30 天', '月结 60 天', '月结 90 天', '月结 30 天，按实际回交数结算', '出货后 30 天',
]);

/** 外贸常用结算币种。 */
export const CURRENCIES: TradeOption[] = [
  ['USD', '美元'], ['EUR', '欧元'], ['CNY', '人民币'], ['GBP', '英镑'], ['HKD', '港币'], ['JPY', '日元'],
  ['AUD', '澳元'], ['CAD', '加元'], ['CHF', '瑞士法郎'], ['SGD', '新加坡元'], ['KRW', '韩元'], ['AED', '阿联酋迪拉姆'],
  ['SEK', '瑞典克朗'], ['NOK', '挪威克朗'], ['DKK', '丹麦克朗'], ['NZD', '新西兰元'], ['MYR', '马来西亚林吉特'], ['THB', '泰铢'],
].map(([value, name]) => ({ value, label: `${value} ${name}` }));

/** 常见贸易国家和地区。 */
export const COUNTRIES: TradeOption[] = plain([
  '中国', '中国香港', '中国台湾', '美国', '加拿大', '墨西哥', '巴西', '智利', '阿根廷', '秘鲁', '哥伦比亚',
  '英国', '爱尔兰', '德国', '法国', '意大利', '西班牙', '葡萄牙', '荷兰', '比利时', '卢森堡', '瑞士', '奥地利',
  '瑞典', '丹麦', '挪威', '芬兰', '波兰', '捷克', '匈牙利', '罗马尼亚', '希腊', '土耳其', '俄罗斯',
  '阿联酋', '沙特阿拉伯', '以色列', '埃及', '摩洛哥', '南非', '尼日利亚',
  '日本', '韩国', '新加坡', '马来西亚', '印度尼西亚', '泰国', '越南', '菲律宾', '柬埔寨', '缅甸',
  '印度', '孟加拉国', '巴基斯坦', '斯里兰卡', '澳大利亚', '新西兰',
]);

/** 国内常用起运港。 */
export const LOADING_PORTS: TradeOption[] = plain([
  '上海', '上海洋山', '宁波', '深圳盐田', '深圳蛇口', '广州南沙', '青岛', '厦门', '天津', '大连',
  '连云港', '张家港', '太仓', '南通', '福州', '香港',
]);
/** 常用目的港。 */
export const DISCHARGE_PORTS: TradeOption[] = plain([
  '洛杉矶', '长滩', '奥克兰（美国）', '西雅图', '纽约', '萨凡纳', '休斯顿', '迈阿密', '温哥华', '多伦多', '蒙特利尔',
  '曼萨尼约', '桑托斯', '瓦尔帕莱索',
  '费利克斯托', '南安普敦', '鹿特丹', '安特卫普', '汉堡', '不来梅哈芬', '勒阿弗尔', '热那亚', '那不勒斯',
  '巴塞罗那', '瓦伦西亚', '比雷埃夫斯', '伊斯坦布尔', '哥德堡', '哥本哈根', '格但斯克', '圣彼得堡',
  '杰贝阿里（迪拜）', '吉达', '亚历山大',
  '东京', '横滨', '名古屋', '大阪', '神户', '釜山', '仁川', '基隆', '高雄', '新加坡', '巴生', '雅加达', '泗水',
  '胡志明', '海防', '林查班', '马尼拉', '吉大港', '那瓦舍瓦', '科伦坡', '卡拉奇',
  '悉尼', '墨尔本', '布里斯班', '奥克兰（新西兰）', '德班',
]);

/** 季节：先列公司季节档案，再补近三年的春夏 SS / 秋冬 AW 标准代码。 */
export function seasonOptions(year: number, seasons: Array<{ code: string; name?: string }> = []): TradeOption[] {
  const own = seasons.filter(season => season.code).map(season => ({ value: season.code, label: season.name && season.name !== season.code ? `${season.code} · ${season.name}` : season.code }));
  const standard = [0, 1, 2].flatMap(offset => { const yy = String((year + offset) % 100).padStart(2, '0'); return [`SS${yy}`, `AW${yy}`]; });
  // 按时间排列：同年春夏在前；不符合 SS/AW 写法的公司季节放最前。
  const order = (code: string) => { const match = /^(SS|AW)(\d{2})$/.exec(code); return match ? Number(match[2]) * 2 + (match[1] === 'AW' ? 1 : 0) : -1; };
  return [...own, ...plain(standard.filter(code => !own.some(option => option.value === code)))].sort((a, b) => order(a.value) - order(b.value));
}

/** 客户档案常用分类。 */
export const INDUSTRIES: TradeOption[] = plain(['服装品牌', '服装零售', '服装批发', '电商零售', '百货商超', '进口商 / 贸易商', '成衣工厂', '面料贸易', '运动户外', '童装', '家纺家居', '制服工装']);
export const CUSTOMER_GRADES: TradeOption[] = [['A', '重点客户'], ['B', '成长客户'], ['C', '一般客户'], ['D', '观察客户']].map(([value, name]) => ({ value, label: `${value} · ${name}` }));
export const PRODUCT_CATEGORIES: TradeOption[] = plain(['面料', '梭织面料', '针织面料', '成衣', '衬衫', 'T恤 / 针织上衣', '卫衣', '外套 / 夹克', '羽绒服', '大衣', '裤装', '牛仔', '连衣裙 / 裙装', '毛衫', '运动服', '童装', '内衣 / 家居服', '家纺']);

/** 空运常用起运和目的机场。 */
export const LOADING_AIRPORTS: TradeOption[] = plain(['上海浦东', '北京首都', '广州白云', '深圳宝安', '杭州萧山', '宁波栎社', '青岛胶东', '厦门高崎', '郑州新郑', '成都天府', '香港']);
export const DISCHARGE_AIRPORTS: TradeOption[] = plain([
  '洛杉矶', '纽约肯尼迪', '芝加哥', '迈阿密', '多伦多', '温哥华', '伦敦希思罗', '法兰克福', '巴黎戴高乐', '阿姆斯特丹', '米兰马尔彭萨', '马德里',
  '伊斯坦布尔', '迪拜', '东京成田', '大阪关西', '首尔仁川', '新加坡樟宜', '曼谷素万那普', '胡志明', '悉尼', '墨尔本',
]);

/** 整笔费用的计费单位。 */
export const CHARGE_UNITS: TradeOption[] = plain(['票', '批', '次', '柜', '箱', '套']);
/** 服装面料常用计量单位。 */
export const UNITS: TradeOption[] = plain(['件', '套', '条', '双', '打', '个', '米', '码', '公斤', '卷', '匹', '粒', '对', '张', '箱']);

/** 样品形态：面料米样按米计，其余按份（与服务端 validFabricSample 同口径）；成衣按开发与大货阶段。 */
export const FABRIC_SAMPLE_FORMS: TradeOption[] = plain(['米样', '色样', '手织样', '剪样', '布样']);
export const GARMENT_SAMPLE_FORMS: TradeOption[] = plain(['头样', '修改样', '尺码样', '销售样', '照相样', '测试样', '产前样', '船样']);
export const sampleFormUnit = (form: string) => form.trim() === '米样' ? '米' : '份';
export const SAMPLE_FORMS: TradeOption[] = [...FABRIC_SAMPLE_FORMS, ...GARMENT_SAMPLE_FORMS];
export const SAMPLE_UNITS = { fabric: plain(['米', '份']), garment: plain(['件', '套', '份']) };

/** 面料规格常用写法。克重、幅宽只有 g/m² 与 cm 会带入报价和产品档案。 */
export const WEAVES: TradeOption[] = plain(['平纹', '斜纹', '缎纹', '提花', '府绸', '牛津纺', '灯芯绒', '双面呢', '汗布', '罗纹', '珠地', '毛圈', '摇粒绒', '经编', '网眼']);
export const FINISHES: TradeOption[] = plain(['磨毛', '砂洗', '水洗', '柔软', '防水', '防污', '抗皱免烫', '抗菌', '阻燃', '涂层', '压光', '烂花', '数码印花', '活性印花']);
export const WEIGHT_UNITS: TradeOption[] = plain(['g/m²', 'oz/yd²']);
export const WIDTH_UNITS: TradeOption[] = plain(['cm', 'inch']);
export const GARMENT_CATEGORIES: TradeOption[] = plain(['大衣', '西装', '套装', '夹克', '外套', '羽绒服', '风衣', '衬衫', 'T恤', 'Polo 衫', '针织', '卫衣', '毛衫', '连衣裙', '半身裙', '裤装', '牛仔', '运动服', '家居服', '童装']);
export const FABRIC_CATEGORIES: TradeOption[] = plain(['梭织', '针织', '毛纺 / 呢绒', '双面呢', '牛仔', '色织', '印花', '功能面料', '蕾丝 / 网布', '里布']);
/** 面料报价只接受 米 / 码 / 公斤（服务端 QUOTE_UNITS）。 */
export const FABRIC_PRICE_UNITS: TradeOption[] = plain(['米', '码', '公斤']);

/** 沟通渠道、营销与供应商档案的常用值。 */
export const CONTACT_CHANNELS: TradeOption[] = plain(['邮件', '电话', '微信', 'WhatsApp', '视频会议', '面谈', '展会']);
export const FEEDBACK_CHANNELS: TradeOption[] = [...CONTACT_CHANNELS, { value: '中间方转达', label: '中间方转达' }];
export const CERTIFICATES: TradeOption[] = plain(['BSCI / amfori', 'SMETA / Sedex', 'WRAP', 'SA8000', 'ISO 9001', 'ISO 14001', 'OEKO-TEX Standard 100', 'GOTS', 'GRS', 'RCS', 'OCS', 'bluesign', 'Higg FEM / FSLM', 'Better Cotton']);
export const CAMPAIGN_TYPES: TradeOption[] = plain(['产品画册', '邮件推广', '样衣寄送', '面料资料推广', '展会邀约', '新品发布', '社交媒体', '客户拜访']);
export const CAPACITY_UNITS: TradeOption[] = plain(['件/月', '套/月', '打/月', '米/月', '码/月', '公斤/月']);

/** 财务：常用开户银行、汇率依据、增值税率、出口退税率（服务端只收数字）、付款触发条件。 */
export const BANKS: TradeOption[] = plain([
  '中国银行', '中国工商银行', '中国建设银行', '中国农业银行', '交通银行', '招商银行', '中信银行', '上海浦东发展银行', '兴业银行',
  '中国民生银行', '中国光大银行', '平安银行', '华夏银行', '广发银行', '宁波银行', '杭州银行', '江苏银行', '浙商银行',
  '汇丰银行（中国）', '渣打银行（中国）', '花旗银行（中国）', '星展银行（中国）',
]);
export const FX_RATE_SOURCES: TradeOption[] = plain(['中国人民银行中间价', '国家外汇管理局折算率', '中国银行外汇牌价', '开户行结汇牌价']);
export const VAT_RATES: TradeOption[] = plain(['13%', '9%', '6%', '3%', '1%', '0%', '免税']);
export const EXPORT_REBATE_RATES: TradeOption[] = ['13', '10', '9', '6', '0'].map(value => ({ value, label: value === '0' ? '0（不退税）' : `${value}%` }));
export const SUPPLIER_PAYMENT_TRIGGERS: TradeOption[] = plain(['合同签订后', '发货前', '到货验收合格后', '收到发票后', '月末对账后', '出运后', '客户回款后']);
export const PAYER_RELATIONS: TradeOption[] = plain(['母公司代付', '子公司 / 关联公司代付', '采购代理代付', '客户书面指定付款方', '第三方支付平台']);

/** 报关与单证。 */
export const CUSTOMS_TRADE_MODES: TradeOption[] = plain(['一般贸易', '进料对口', '来料加工', '市场采购', '跨境电商 B2B 直接出口', '跨境电商出口海外仓', '其他']);
export const CUSTOMS_UNITS: TradeOption[] = plain(['件', '套', '条', '双', '个', '千克', '米', '平方米', '打']);
/** 申报要素常用写法（按要素名称取用；成分、规格、品牌按实际填写）。 */
export const CUSTOMS_ELEMENT_OPTIONS: Partial<Record<string, TradeOption[]>> = {
  织造方法: plain(['机织', '针织', '钩编', '非织造']),
  种类: GARMENT_CATEGORIES,
  类别: plain(['男式', '女式', '男童', '女童', '中性']),
  染整方法: plain(['漂白', '未漂白', '染色', '色织', '印花']),
};
export const DOCUMENT_ISSUERS: TradeOption[] = plain(['中国国际贸易促进委员会', '海关', 'SGS', 'Intertek', 'BV 必维', 'TÜV', '船公司', '货代']);
export const LC_EXPIRY_PLACES: TradeOption[] = plain(['中国', '受益人所在地', '议付行柜台', '开证行柜台']);

/** 常用选项之外保留原值，避免已录入内容被清空。 */
export function withCurrent<T extends TradeOption>(options: T[], current: string | undefined | null): TradeOption[] {
  const value = (current ?? '').trim();
  return !value || options.some(option => option.value === value) ? options : [...options, { value, label: value }];
}
