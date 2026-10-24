import {replacementDeclaredUnitPrice} from './mistClaimReplacement';
/**
 * 报关申报资料（2026-10-18 按《中华人民共和国海关进出口货物报关单填制规范》与《规范申报目录》的通行做法确定首版）。
 * - 商品归类库：单证员按款号建立归类档案——10 位商品编号（HS）、申报品名、申报要素（品牌类型、出口享惠情况及按章节的必报要素）、法定第一 / 第二计量单位。
 * - 申报商品项：按出运明细自动生成——每条出运明细按款号匹配归类档案；同一归类、同一成交单位与币制的明细合并为一个商品项。
 *   成交数量 = 出运数量；销售货值取订单单价，批准补发取单证核定申报单价；法定数量按单位换算或取装箱净重；件数、毛重、净重取装箱合计。
 * - 手工微调：生成后可逐项调整申报品名、申报要素与法定数量（报关行审单意见常见于此），须填原因并留痕；商品编号、成交数量与总价不改（改归类或出运后重新生成，总价与 CI 一致）。
 *   重新生成时，某项的某个字段若自动生成值没变，保留手工调整；自动值变了（归类、出运或装箱改了）则以新值为准、需要再调。
 * - 本系统只准备申报资料、交给报关行或在单一窗口录入，不代替海关申报；已放行的报关记录不再改动。
 */
import { MistCommandError, lineAmount, mistMoneyMinor, type MistContext, type MistState } from './mistWorkspace';
import type { FulfillmentCustoms, FulfillmentShipment } from './mistFulfillment';
import { stableJson } from './stableJson';

export type CustomsFamily = 'garment' | 'fabric';
export const CUSTOMS_FAMILY_LABEL: Record<CustomsFamily, string> = { garment: '服装', fabric: '面料' };
/** 申报要素（品牌类型、出口享惠情况之后的必报项，按章节）。服装的货号在生成商品项时按款号自动填入。 */
export const CUSTOMS_ELEMENT_LABELS: Record<CustomsFamily, string[]> = {
  garment: ['织造方法', '种类', '类别', '成分含量', '品牌'],
  fabric: ['织造方法', '染整方法', '成分含量', '规格（幅宽、克重）', '品牌'],
};
export const CUSTOMS_BRAND_TYPES = [['0', '无品牌'], ['1', '境内自主品牌'], ['2', '境内收购品牌'], ['3', '境外品牌（贴牌生产）'], ['4', '境外品牌（其它）']] as const;
export const CUSTOMS_PREFERENCES = [['0', '出口货物在最终目的国（地区）不享受优惠关税'], ['1', '出口货物在最终目的国（地区）享受优惠关税'], ['2', '出口货物不能确定在最终目的国（地区）享受优惠关税']] as const;
export const CUSTOMS_MAX_ITEMS = 50;

export type CustomsClassification = { id: string; code: string; family: CustomsFamily; hsCode: string; declaredName: string; brandType: string; preference: string; elements: string[]; legalUnit: string; secondUnit: string; styles: string[]; note: string; createdAt: string; actor: string; updatedAt?: string; voided?: { at: string; actor: string; reason: string } };
export type CustomsDeclarationItem = { no: number; classificationId: string; lineKeys: string[]; styles: string[]; hsCode: string; declaredName: string; elements: string; quantity: number; unit: string; legalQty: number; legalUnit: string; secondQty: number | null; secondUnit: string; unitPrice: number; amount: number; currency: string; origin: string; destination: string; generated?: Partial<Pick<CustomsDeclarationItem, CustomsAdjustableField>>; adjusted?: { at: string; actor: string; reason: string; fields: CustomsAdjustableField[] } };
export const CUSTOMS_ADJUSTABLE_FIELDS = ['declaredName', 'elements', 'legalQty', 'secondQty'] as const;
export type CustomsAdjustableField = typeof CUSTOMS_ADJUSTABLE_FIELDS[number];
export const CUSTOMS_FIELD_LABEL: Record<CustomsAdjustableField, string> = { declaredName: '申报品名', elements: '申报要素', legalQty: '法定数量', secondQty: '第二数量' };
export type CustomsDeclarationDraft = { items: CustomsDeclarationItem[]; blockers: string[]; packages: number; netWeight: number; grossWeight: number; totals: Array<{ currency: string; amount: number }> };
export type CustomsDeclarationCommand =
  | { type: 'fulfillment.customs.classify.save'; payload: { id?: string; family: CustomsFamily; hsCode: string; declaredName: string; brandType: string; preference: string; elements: string[]; legalUnit?: string; secondUnit?: string; styles: string[]; note?: string } }
  | { type: 'fulfillment.customs.classify.void'; payload: { id: string; reason: string } }
  | { type: 'fulfillment.customs.items'; payload: { id: string } }
  | { type: 'fulfillment.customs.item.adjust'; payload: { id: string; no: number; declaredName: string; elements: string; legalQty: number; secondQty?: number | null; reason: string } };
export const CUSTOMS_DECLARATION_COMMANDS = ['fulfillment.customs.classify.save', 'fulfillment.customs.classify.void', 'fulfillment.customs.items', 'fulfillment.customs.item.adjust'] as const;

type Root = MistState & { fulfillment: MistState['fulfillment'] & { customsClassifications?: CustomsClassification[] } };
const fail = (message: string, code = 'VALIDATION'): never => { throw new MistCommandError(code, message, code === 'NOT_FOUND' ? 404 : 422); };
const str = (v: unknown, label: string, required = true, max = 200) => { const t = typeof v === 'string' ? v.trim() : ''; if (required && !t) fail(`请填写${label}`); if (t.length > max) fail(`${label}过长`); return t; };
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
export const readCustomsClassifications = (root: Pick<MistState, 'fulfillment'>) => ((root.fulfillment as Root['fulfillment'])?.customsClassifications || []);
export const hsDigits = (hs: string) => (hs || '').replace(/\D/g, '');
/** 由 HS 章节判定板块：61/62 章服装，50–60 章纺织面料。 */
export function customsFamilyOf(hs: string): CustomsFamily | undefined { const ch = Number(hsDigits(hs).slice(0, 2)); return ch === 61 || ch === 62 ? 'garment' : ch >= 50 && ch <= 60 ? 'fabric' : undefined; }
/** 法定计量单位默认值（以海关商品编码表为准，可在归类档案中改）：西服套装 套/千克，其他服装 件/千克，机织面料 米/千克，针织面料（60 章）千克。 */
export function defaultLegalUnits(hs: string): { legalUnit: string; secondUnit: string } {
  const d = hsDigits(hs), ch = d.slice(0, 2);
  if (ch === '61' || ch === '62') return { legalUnit: ['61031', '61041', '62031', '62041'].some(p => d.startsWith(p)) ? '套' : '件', secondUnit: '千克' };
  if (ch === '60') return { legalUnit: '千克', secondUnit: '' };
  if (Number(ch) >= 50 && Number(ch) <= 59) return { legalUnit: '米', secondUnit: '千克' };
  return { legalUnit: '千克', secondUnit: '' };
}
const UNIT_ALIASES: Record<string, string> = { pcs: '件', pc: '件', piece: '件', pieces: '件', 件: '件', set: '套', sets: '套', 套: '套', m: '米', meter: '米', meters: '米', 米: '米', yd: '码', yds: '码', yard: '码', yards: '码', 码: '码', kg: '千克', kgs: '千克', 公斤: '千克', 千克: '千克', 条: '条', 双: '双' };
export const normalizeUnit = (u: string) => UNIT_ALIASES[(u || '').trim().toLowerCase()] || (u || '').trim();
const styleKey = (s: string) => (s || '').trim().toUpperCase();
export function classificationForStyle(root: Pick<MistState, 'fulfillment'>, style: string) { const k = styleKey(style); return k ? readCustomsClassifications(root).find(c => !c.voided && c.styles.some(s => styleKey(s) === k)) : undefined; }
export function customsElementsText(c: Pick<CustomsClassification, 'family' | 'brandType' | 'preference' | 'elements'>, styles: string[]) {
  return [c.brandType, c.preference, ...c.elements, ...(c.family === 'garment' ? ['货号' + styles.join('/')] : [])].join('|');
}

/** 按当前出运、装箱与归类库生成申报商品项；不能生成的原因逐条列出，不猜。 */
export function draftCustomsDeclaration(root: MistState, shipment: FulfillmentShipment): CustomsDeclarationDraft {
  const blockers: string[] = [], packing = root.fulfillment.packing.filter(r => r.shipmentId === shipment.id);
  const customer = root.customers.find(c => c.id === shipment.customerId);
  const groups = new Map<string, { cls: CustomsClassification; unit: string; currency: string; lines: Array<{ key: string; style: string; quantity: number; amountMinor: number; net: number }> }>();
  if (!shipment.lines.length) blockers.push('出运没有明细');
  for (const line of shipment.lines) {
    const ol = root.orderLines.find(l => l.id === line.lineId), order = root.orders.find(o => o.id === line.orderId);
    if (!ol || !order) { blockers.push('出运明细的订单条目不可用'); continue; }
    const cls = classificationForStyle(root, ol.style);
    if (!cls) { blockers.push(`款号 ${ol.style || '（未填写）'} · ${ol.name} 尚未建立商品归类`); continue; }
    const unit = normalizeUnit(ol.unit), key = `${line.lineId}:${line.productionId || ''}`;
    const net = packing.filter(r => r.lineId === line.lineId && (r.productionId || '') === (line.productionId || '')).reduce((s, r) => s + r.netWeight, 0);
    const gk = `${cls.id}|${unit}|${order.currency}`;
    const g = groups.get(gk) || { cls, unit, currency: order.currency, lines: [] };
    let price=ol.price;
    if(order.replacementSource){try{price=replacementDeclaredUnitPrice(root,shipment.id,order.id,ol.id)!;}catch(error){if(!(error instanceof MistCommandError))throw error;blockers.push(error.message);continue;}}
    g.lines.push({ key, style: ol.style, quantity: line.quantity, amountMinor: mistMoneyMinor(lineAmount(line.quantity, price)), net });
    groups.set(gk, g);
  }
  const needsWeight = [...groups.values()].some(g => normalizeUnit(g.cls.legalUnit) === '千克' || g.cls.secondUnit);
  if (needsWeight && !packing.length) blockers.push('尚未装箱：法定数量（千克）须取装箱净重');
  const items: CustomsDeclarationItem[] = [];
  for (const g of groups.values()) {
    const quantity = round(g.lines.reduce((s, l) => s + l.quantity, 0)), net = round(g.lines.reduce((s, l) => s + l.net, 0), 2), amountMinor = g.lines.reduce((s, l) => s + l.amountMinor, 0);
    const styles = [...new Set(g.lines.map(l => l.style).filter(Boolean))];
    const convert = (target: string): number | null => { const t = normalizeUnit(target); if (!t) return null; if (t === g.unit) return quantity; if (g.unit === '码' && t === '米') return round(quantity * 0.9144, 2); if (t === '千克') return net > 0 ? net : null; return null; };
    const legalQty = convert(g.cls.legalUnit), secondQty = g.cls.secondUnit ? convert(g.cls.secondUnit) : null;
    if (legalQty === null && packing.length) blockers.push(`${g.cls.declaredName}（${styles.join('/')}）：成交单位“${g.unit}”无法换算为法定单位“${g.cls.legalUnit}”，请核对归类档案的法定单位`);
    if (g.cls.secondUnit && secondQty === null && packing.length) blockers.push(`${g.cls.declaredName}（${styles.join('/')}）：第二单位“${g.cls.secondUnit}”取不到装箱净重`);
    items.push({ no: items.length + 1, classificationId: g.cls.id, lineKeys: g.lines.map(l => l.key), styles, hsCode: g.cls.hsCode, declaredName: g.cls.declaredName, elements: customsElementsText(g.cls, styles), quantity, unit: g.unit, legalQty: legalQty ?? 0, legalUnit: g.cls.legalUnit, secondQty, secondUnit: g.cls.secondUnit, unitPrice: quantity > 0 ? round(amountMinor / 100 / quantity) : 0, amount: amountMinor / 100, currency: g.currency, origin: '中国', destination: customer?.country || '' });
  }
  if (items.length > CUSTOMS_MAX_ITEMS) blockers.push(`商品项 ${items.length} 项，超过一份报关单 ${CUSTOMS_MAX_ITEMS} 项上限，请拆分出运`);
  const totals = new Map<string, number>(); for (const i of items) totals.set(i.currency, (totals.get(i.currency) || 0) + mistMoneyMinor(i.amount));
  return { items, blockers, packages: new Set(packing.map(r => r.carton)).size, netWeight: round(packing.reduce((s, r) => s + r.netWeight, 0), 2), grossWeight: round(packing.reduce((s, r) => s + r.grossWeight, 0), 2), totals: [...totals].map(([currency, minor]) => ({ currency, amount: minor / 100 })) };
}
/** 已保存的商品项与当前出运 / 装箱是否仍一致（出运明细或装箱改了就要重新生成）。 */
export function customsItemsStale(root: MistState, c: FulfillmentCustoms & { items?: CustomsDeclarationItem[] }) {
  const s = root.fulfillment.shipments.find(x => x.id === c.shipmentId);
  if (!s || !c.items?.length) return false;
  const now = draftCustomsDeclaration(root, s);
  return stableJson(now.items) !== stableJson(c.items.map(generatedItem));
}
/** 去掉手工调整、还原为自动生成时的商品项（用于与当前出运比对）。 */
export function generatedItem(item: CustomsDeclarationItem): CustomsDeclarationItem {
  const { generated, adjusted: _adjusted, ...rest } = item;
  return { ...rest, ...(generated || {}) };
}
/** 重新生成时：同一商品项（同归类、单位、币制）中自动值未变的字段，保留原手工调整。 */
function carryAdjustments(previous: CustomsDeclarationItem[], next: CustomsDeclarationItem[]) {
  let kept = 0;
  for (const item of next) {
    const old = previous.find(p => p.adjusted && p.classificationId === item.classificationId && p.unit === item.unit && p.currency === item.currency);
    if (!old?.adjusted || !old.generated) continue;
    const fields = old.adjusted.fields.filter(k => k in old.generated! && old.generated![k] === item[k]);
    if (!fields.length) continue;
    const generated: CustomsDeclarationItem['generated'] = {};
    for (const k of fields) { (generated as Record<string, unknown>)[k] = item[k]; (item as Record<string, unknown>)[k] = old[k]; }
    Object.assign(item, { generated, adjusted: { ...old.adjusted, fields } });
    kept++;
  }
  return kept;
}

export function applyCustomsDeclarationCommand(root: MistState, command: CustomsDeclarationCommand, ctx: MistContext): { id: string } {
  const f = root.fulfillment as Root['fulfillment'];
  const list = f.customsClassifications ||= [];
  const event = (id: string, text: string) => root.events.unshift({ id: ctx.id(), entityType: 'customs', entityId: id, actor: ctx.actorName, at: ctx.now, text, fileIds: [] });
  if (command.type === 'fulfillment.customs.classify.save') {
    const p = command.payload || ({} as never);
    const old = p.id ? list.find(c => c.id === p.id) || fail('商品归类不存在', 'NOT_FOUND') : undefined;
    if (old?.voided) fail('已作废的归类不能修改，请新建');
    const family = p.family === 'garment' || p.family === 'fabric' ? p.family : fail('请选择服装或面料');
    const hs = hsDigits(str(p.hsCode, '商品编号'));
    if (hs.length !== 10) fail('商品编号须为 10 位数字');
    if (customsFamilyOf(hs) !== family) fail(family === 'garment' ? '服装商品编号应在第 61 或 62 章' : '面料商品编号应在第 50–60 章');
    const declaredName = str(p.declaredName, '申报品名', true, 50);
    const brandType = CUSTOMS_BRAND_TYPES.some(([v]) => v === p.brandType) ? p.brandType : fail('请选择品牌类型');
    const preference = CUSTOMS_PREFERENCES.some(([v]) => v === p.preference) ? p.preference : fail('请选择出口享惠情况');
    const labels = CUSTOMS_ELEMENT_LABELS[family];
    if (!Array.isArray(p.elements) || p.elements.length !== labels.length) fail('申报要素项数不符');
    const elements = labels.map((label, i) => { const v = str(p.elements[i], label, true, 100); if (v.includes('|')) fail(`${label}不能包含“|”`); return v; });
    const defaults = defaultLegalUnits(hs);
    const legalUnit = normalizeUnit(str(p.legalUnit, '法定第一单位', false, 10)) || defaults.legalUnit;
    const secondUnit = p.legalUnit === undefined && p.secondUnit === undefined ? defaults.secondUnit : normalizeUnit(str(p.secondUnit, '法定第二单位', false, 10));
    if (secondUnit && secondUnit === legalUnit) fail('法定第二单位不能与第一单位相同');
    const styles = [...new Map((Array.isArray(p.styles) ? p.styles : []).map(s => str(s, '款号', false, 60)).filter(Boolean).map(s => [styleKey(s), s])).values()];
    if (!styles.length) fail('请至少填写一个款号');
    for (const s of styles) { const other = list.find(c => !c.voided && c.id !== old?.id && c.styles.some(x => styleKey(x) === styleKey(s))); if (other) fail(`款号 ${s} 已在归类 ${other.code}（${other.declaredName}）中`); }
    const row: CustomsClassification = { id: old?.id || ctx.id(), code: old?.code || `HSC-${String(list.length + 1).padStart(4, '0')}`, family, hsCode: hs, declaredName, brandType, preference, elements, legalUnit, secondUnit, styles, note: str(p.note, '备注', false, 500), createdAt: old?.createdAt || ctx.now, actor: old?.actor || ctx.actorName, ...(old ? { updatedAt: ctx.now } : {}) };
    if (old) Object.assign(old, row); else list.push(row);
    event(row.id, `${old ? '修改' : '建立'}商品归类 ${row.code}：${hs} ${declaredName}（款号 ${styles.join('、')}）`);
    return { id: row.id };
  }
  if (command.type === 'fulfillment.customs.classify.void') {
    const c = list.find(x => x.id === command.payload?.id) || fail('商品归类不存在', 'NOT_FOUND');
    if (c.voided) fail('该归类已作废');
    const reason = str(command.payload.reason, '作废原因', true, 500);
    c.voided = { at: ctx.now, actor: ctx.actorName, reason };
    event(c.id, `作废商品归类 ${c.code}：${reason}`);
    return { id: c.id };
  }
  if (command.type === 'fulfillment.customs.items') {
    const c = f.customs.find(x => x.id === command.payload?.id) as (FulfillmentCustoms & { items?: CustomsDeclarationItem[] }) | undefined || fail('报关记录不存在', 'NOT_FOUND');
    if (c.status === 'cleared') fail('已放行的报关记录不可改动');
    const s = f.shipments.find(x => x.id === c.shipmentId) || fail('出运不存在', 'NOT_FOUND');
    if (s.state === 'departed' || s.state === 'cancelled') fail('出运已离港或已取消，报关记录不能再修改');
    const draft = draftCustomsDeclaration(root, s);
    if (draft.blockers.length) fail(draft.blockers.join('；'), 'PRECONDITION');
    const main = [...draft.items].sort((a, b) => b.amount - a.amount)[0];
    const kept = carryAdjustments(c.items || [], draft.items);
    Object.assign(c, { items: draft.items, itemsAt: ctx.now, itemsBy: ctx.actorName, packages: draft.packages, netWeight: draft.netWeight, grossWeight: draft.grossWeight, hsCode: main.hsCode });
    event(c.id, `生成申报商品项 ${draft.items.length} 项：${draft.totals.map(t => `${t.currency} ${t.amount.toFixed(2)}`).join(' / ')}；${draft.packages} 件、毛重 ${draft.grossWeight} kg、净重 ${draft.netWeight} kg${kept ? `；保留 ${kept} 项手工调整` : ''}`);
    return { id: c.id };
  }
  if (command.type === 'fulfillment.customs.item.adjust') {
    const p = command.payload || ({} as never);
    const c = f.customs.find(x => x.id === p.id) as (FulfillmentCustoms & { items?: CustomsDeclarationItem[] }) | undefined || fail('报关记录不存在', 'NOT_FOUND');
    if (c.status === 'cleared') fail('已放行的报关记录不可改动');
    const s = f.shipments.find(x => x.id === c.shipmentId) || fail('出运不存在', 'NOT_FOUND');
    if (s.state === 'departed' || s.state === 'cancelled') fail('出运已离港或已取消，报关记录不能再修改');
    const item = (c.items || []).find(i => i.no === p.no) || fail('申报商品项不存在，请先生成', 'NOT_FOUND');
    const declaredName = str(p.declaredName, '申报品名', true, 50);
    const elements = str(p.elements, '申报要素', true, 255);
    const qty = (v: unknown, label: string) => { const n = typeof v === 'number' ? v : Number(v); if (!Number.isFinite(n) || n <= 0) fail(`${label}须大于 0`); return round(n, 4); };
    const legalQty = qty(p.legalQty, '法定数量');
    const secondQty = item.secondUnit ? qty(p.secondQty, '第二数量') : null;
    const reason = str(p.reason, '调整原因', true, 200);
    const base = generatedItem(item), next = { declaredName, elements, legalQty, secondQty };
    const fields = CUSTOMS_ADJUSTABLE_FIELDS.filter(k => next[k] !== base[k]);
    const changed = CUSTOMS_ADJUSTABLE_FIELDS.filter(k => next[k] !== item[k]);
    if (!changed.length) fail('没有改动');
    Object.assign(item, next);
    delete item.generated; delete item.adjusted;
    if (fields.length) Object.assign(item, { generated: Object.fromEntries(fields.map(k => [k, base[k]])), adjusted: { at: ctx.now, actor: ctx.actorName, reason, fields } });
    event(c.id, fields.length ? `手工调整申报商品项 ${item.no}（${changed.map(k => CUSTOMS_FIELD_LABEL[k]).join('、')}）：${reason}` : `申报商品项 ${item.no} 恢复为自动生成值：${reason}`);
    return { id: c.id };
  }
  return fail('未知报关操作');
}
