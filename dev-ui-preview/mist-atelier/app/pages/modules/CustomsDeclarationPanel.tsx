import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** 报关申报资料：商品归类库（款号 → HS、申报品名、申报要素、法定单位）与按出运生成的申报商品项。 */
import React from 'react';
import { Ban, ListChecks, Pencil, Plus } from 'lucide-react';
import { Banner, Button, Card, CardHeader, DataTable, Facts, Mono, Pill, type Column } from '../../../../../components/mist';
import type { MistCommand, MistState } from '../../../../../server/src/shared/mistWorkspace';
import type { FulfillmentCustoms } from '../../../../../server/src/shared/mistFulfillment';
import { CUSTOMS_BRAND_TYPES, CUSTOMS_ELEMENT_LABELS, CUSTOMS_FIELD_LABEL, CUSTOMS_FAMILY_LABEL, CUSTOMS_PREFERENCES, customsItemsStale, defaultLegalUnits, draftCustomsDeclaration, generatedItem, readCustomsClassifications, type CustomsClassification, type CustomsDeclarationItem, type CustomsFamily } from '../../../../../server/src/shared/mistCustomsDeclaration';
import type { ModuleEditorSpec, ModuleValues } from './ModuleWorkbench';
import { field, number, text } from './fulfillmentKit';
import { ActionBar, DetailBlock, businessWhen,type ReasonedAction } from './pageKit';
import { CUSTOMS_ELEMENT_OPTIONS, CUSTOMS_UNITS } from '../../runtime/tradeOptions';

const hsText = (hs: string) => hs.length === 10 ? `${hs.slice(0, 4)}.${hs.slice(4, 6)}.${hs.slice(6)}` : hs;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const elementKey = (i: number) => 'element' + i;

export function classificationSpec(family: CustomsFamily, run: (c: MistCommand) => Promise<unknown>, old?: CustomsClassification): ModuleEditorSpec {
  const labels = CUSTOMS_ELEMENT_LABELS[family], defaults = defaultLegalUnits(family === 'garment' ? '6203' : '5112');
  return {
    title: old ? `修改商品归类 ${old.code}` : `新建${CUSTOMS_FAMILY_LABEL[family]}商品归类`, submitLabel: old ? '保存修改' : '建立归类',
    fields: [
      field('hsCode', '商品编号（10 位）'),
      field('declaredName', '申报品名'),
      { ...field('styles', '适用款号'), hint: '多个款号用逗号分隔' },
      field('brandType', '品牌类型', 'select', true, CUSTOMS_BRAND_TYPES.map(([v, l]) => ({ value: v, label: `${v} ${l}` }))),
      field('preference', '出口享惠情况', 'select', true, CUSTOMS_PREFERENCES.map(([v, l]) => ({ value: v, label: `${v} ${l}` }))),
      ...labels.map((label, i) => CUSTOMS_ELEMENT_OPTIONS[label] ? field(elementKey(i), label, 'choice', true, CUSTOMS_ELEMENT_OPTIONS[label]) : field(elementKey(i), label)),
      { ...field('legalUnit', '法定第一单位', 'choice', false, CUSTOMS_UNITS), strict: true, hint: `留空按编号默认（${family === 'garment' ? '西服套装为套，其他服装为件' : '机织面料为米，针织面料为千克'}）` },
      { ...field('secondUnit', '法定第二单位', 'choice', false, CUSTOMS_UNITS), strict: true, hint: `默认${defaults.secondUnit || '无'}` },
      field('note', '备注', 'textarea', false),
    ],
    initialValues: { hsCode: old?.hsCode || '', declaredName: old?.declaredName || '', styles: old?.styles.join(', ') || '', brandType: old?.brandType || '0', preference: old?.preference || '0', ...Object.fromEntries(labels.map((_, i) => [elementKey(i), old?.elements[i] || (labels[i] === '品牌' ? '无品牌' : '')])), legalUnit: old?.legalUnit || '', secondUnit: old ? old.secondUnit : defaults.secondUnit, note: old?.note || '' },
    submit: (v: ModuleValues) => run({ type: 'fulfillment.customs.classify.save', payload: { ...(old ? { id: old.id } : {}), family, hsCode: text(v, 'hsCode'), declaredName: text(v, 'declaredName'), styles: text(v, 'styles').split(/[,，、\s]+/).filter(Boolean), brandType: text(v, 'brandType'), preference: text(v, 'preference'), elements: labels.map((_, i) => text(v, elementKey(i))), legalUnit: text(v, 'legalUnit'), secondUnit: text(v, 'secondUnit'), note: text(v, 'note') } } as MistCommand),
  };
}

export function CustomsClassificationLedger({ state, domain, needle, can, locked, open, run }: { state: MistState; domain: CustomsFamily; needle: string; can: boolean; locked: boolean; open: (spec: ModuleEditorSpec) => void; run: (c: MistCommand) => Promise<unknown> }) {
  const [showVoided, setShowVoided] = React.useState(false);
  const all = readCustomsClassifications(state).filter(c => c.family === domain);
  const rows = all.filter(c => (showVoided || !c.voided) && (!needle || `${c.code} ${c.hsCode} ${c.declaredName} ${c.styles.join(' ')}`.toLowerCase().includes(needle)));
  const voidSpec = (c: CustomsClassification): ModuleEditorSpec => ({ title: `作废商品归类 ${c.code}`, submitLabel: '作废', description: '作废后不再用于新生成的申报商品项；已生成的保留原样。', fields: [field('reason', '作废原因', 'textarea')], initialValues: { reason: '' }, submit: v => run({ type: 'fulfillment.customs.classify.void', payload: { id: c.id, reason: text(v, 'reason') } } as MistCommand) });
  const columns: Column<CustomsClassification>[] = [
    { key: 'code', header: '归类 / 商品编号', width: 'minmax(150px,1fr)', render: c => <div className="mist-col" style={{ gap: 2 }}><Mono>{hsText(c.hsCode)}</Mono><small className="mist-muted">{c.code}{uiText(c.voided ? ' · 已作废' : '')}</small></div> },
    { key: 'name', header: '申报品名', width: 'minmax(140px,1.2fr)', render: c => c.declaredName },
    { key: 'elements', header: '申报要素', hideOnMobile: true, render: c => <small>{[c.brandType, c.preference, ...c.elements].join('|')}</small> },
    { key: 'unit', header: '法定单位', width: '100px', hideOnMobile: true, render: c => c.secondUnit ? `${c.legalUnit} / ${c.secondUnit}` : c.legalUnit },
    { key: 'styles', header: '适用款号', width: 'minmax(120px,1fr)', render: c => c.styles.join('、') },
    ...(can ? [{ key: 'act', header: '', width: '150px', align: 'right' as const, render: (c: CustomsClassification) => c.voided ? <span className="mist-muted">{c.voided.reason}</span> : <span className="mist-row"><Button size="sm" icon={Pencil} disabled={locked} aria-label={ui`修改 ${c.code}`} onClick={() => open(classificationSpec(c.family, run, c))}>{uiText("修改")}</Button><Button size="sm" icon={Ban} disabled={locked} aria-label={ui`作废 ${c.code}`} onClick={() => open(voidSpec(c))}>{uiText("作废")}</Button></span> }] : []),
  ];
  return <div className="mist-section"><Card data-customs-classifications>
    <CardHeader title={ui`${CUSTOMS_FAMILY_LABEL[domain]}商品归类 · ${all.filter(c => !c.voided).length}`}
      tools={<span className="mist-row"><Button size="sm" onClick={() => setShowVoided(v => !v)}>{uiText(showVoided ? '隐藏已作废' : '显示已作废')}</Button>{can && <Button size="sm" variant="primary" icon={Plus} disabled={locked} onClick={() => open(classificationSpec(domain, run))}>{uiText("新建归类")}</Button>}</span>} />
    <DataTable ariaLabel={uiText("商品归类库")} rows={rows} rowKey={c => c.id} columns={columns} empty={all.length ? '没有符合条件的归类' : '尚未建立商品归类'} />
  </Card></div>;
}

/** 手工微调一个商品项：只改申报品名、要素与法定数量；商品编号、成交数量与总价随归类与出运，不在这里改。 */
export function adjustItemSpec(c: FulfillmentCustoms, item: CustomsDeclarationItem, run: (c: MistCommand) => Promise<unknown>): ModuleEditorSpec {
  const auto = generatedItem(item);
  return {
    title: `调整申报商品项 ${item.no}`, submitLabel: '保存调整',
    fields: [
      { ...field('declaredName', '申报品名'), hint: `自动值：${auto.declaredName}` },
      { ...field('elements', '申报要素', 'textarea'), hint: `按“|”分隔；自动值：${auto.elements}` },
      { ...field('legalQty', `法定数量（${item.legalUnit}）`, 'number'), hint: `自动值：${auto.legalQty}` },
      ...(item.secondUnit ? [{ ...field('secondQty', `第二数量（${item.secondUnit}）`, 'number'), hint: `自动值：${auto.secondQty ?? '—'}` }] : []),
      { ...field('reason', '调整原因', 'textarea'), hint: undefined },
    ],
    initialValues: { declaredName: item.declaredName, elements: item.elements, legalQty: item.legalQty, ...(item.secondUnit ? { secondQty: item.secondQty ?? '' } : {}), reason: '' },
    submit: v => run({ type: 'fulfillment.customs.item.adjust', payload: { id: c.id, no: item.no, declaredName: text(v, 'declaredName'), elements: text(v, 'elements'), legalQty: number(v, 'legalQty'), ...(item.secondUnit ? { secondQty: number(v, 'secondQty') } : {}), reason: text(v, 'reason') } } as MistCommand),
  };
}

export function CustomsItemsBlock({ record: c, state, can, locked, run, open, onClassify }: { record: FulfillmentCustoms; state: MistState; can: boolean; locked: boolean; run: (c: MistCommand) => Promise<unknown>; open: (spec: ModuleEditorSpec) => void; onClassify: () => void }) {
  const s = state.fulfillment.shipments.find(x => x.id === c.shipmentId);
  const draft = s ? draftCustomsDeclaration(state, s) : undefined;
  const items = c.items || [], stale = customsItemsStale(state, c);
  const closed = !s || s.state === 'departed' || s.state === 'cancelled';
  const reason = !can ? '需要报关单证权限' : c.status === 'cleared' ? '已放行的报关记录不可改动' : closed ? '出运已离港或已取消' : draft?.blockers.length ? '先处理下列问题' : false;
  const editable = can && c.status !== 'cleared' && !closed;
  const totals = new Map<string, number>(); for (const i of items) totals.set(i.currency, Math.round(((totals.get(i.currency) || 0) + i.amount) * 100) / 100);
  const columns: Column<CustomsDeclarationItem>[] = [
    { key: 'no', header: '项号', width: '52px', render: i => i.no },
    { key: 'hs', header: '商品编号', width: '120px', render: i => <Mono>{hsText(i.hsCode)}</Mono> },
    { key: 'name', header: '商品名称及规格型号', width: 'minmax(200px,2fr)', render: i => <div className="mist-col" style={{ gap: 2 }}><b>{i.declaredName}</b><small className="mist-muted">{i.elements}</small>{i.adjusted && <small data-customs-item-adjusted={i.no}><Pill tone="warn">{uiText("手工调整")}</Pill> {i.adjusted.fields.map(k => CUSTOMS_FIELD_LABEL[k]).join('、')} · {i.adjusted.actor} · {i.adjusted.reason}</small>}</div> },
    { key: 'qty', header: '数量及单位', width: 'minmax(120px,1fr)', render: i => <div className="mist-col" style={{ gap: 2 }}><span>{i.quantity} {uiText(i.unit)}</span><small className="mist-muted">{uiText("法定 ")}{i.legalQty} {i.legalUnit}{uiText(i.secondUnit ? ` · ${i.secondQty ?? '—'} ${i.secondUnit}` : '')}</small></div> },
    { key: 'price', header: '单价 / 总价', width: '140px', align: 'right', render: i => <div className="mist-col" style={{ gap: 2 }}><span>{i.unitPrice}</span><b>{i.currency} {money(i.amount)}</b></div> },
    ...(editable ? [{ key: 'act', header: '', width: '84px', align: 'right' as const, render: (i: CustomsDeclarationItem) => <Button size="sm" icon={Pencil} disabled={locked} aria-label={ui`调整商品项 ${i.no}`} onClick={() => open(adjustItemSpec(c, i, run))}>{uiText("调整")}</Button> }] : []),
  ];
  return <DetailBlock title={uiText("申报商品项")} aside={items.length ? <span className="mist-muted">{c.itemsBy} · {c.itemsAt?businessWhen(c.itemsAt):'—'}</span> : undefined}>
    {items.length > 0 ? <>
      {stale && c.status !== 'cleared' && <Banner tone="warn" title={uiText("出运或装箱已变化")}>{uiText("已生成的商品项与当前出运明细、装箱或归类不一致，请重新生成后再交报关行。")}</Banner>}
      {items.some(i => i.adjusted) && <span className="mist-note">{uiText("重新生成时，自动值没变的字段保留手工调整；归类、出运或装箱改动导致自动值变化的字段以新值为准。")}</span>}
      <DataTable ariaLabel={ui`${c.code} 申报商品项`} rows={items} rowKey={i => String(i.no)} columns={columns} />
      <Facts cols={4} items={[{ label: '件数', value: `${c.packages ?? 0} 件` }, { label: '毛重', value: `${c.grossWeight ?? 0} kg` }, { label: '净重', value: `${c.netWeight ?? 0} kg` }, { label: '总价', value: [...totals].map(([cur, n]) => `${cur} ${money(n)}`).join(' / ') }]} />
    </> : <span className="mist-note">{uiText("尚未生成")}</span>}
    {c.status !== 'cleared' && draft && draft.blockers.length > 0 && <Banner tone="warn" title={uiText("还不能生成")}>{draft.blockers.join('；')}</Banner>}
    {can && c.status !== 'cleared' && <ActionBar busy={locked} actions={[
      { label: items.length ? '重新生成商品项' : '生成申报商品项', icon: ListChecks, primary: !items.length || stale, reason, onClick: () => void run({ type: 'fulfillment.customs.items', payload: { id: c.id } } as MistCommand) },
      { label: '维护商品归类', onClick: onClassify },
    ] as ReasonedAction[]} />}
  </DetailBlock>;
}
