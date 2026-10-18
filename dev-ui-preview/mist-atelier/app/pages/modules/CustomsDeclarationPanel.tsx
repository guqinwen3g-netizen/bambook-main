/** 报关申报资料：商品归类库（款号 → HS、申报品名、申报要素、法定单位）与按出运生成的申报商品项。 */
import React from 'react';
import { Ban, ListChecks, Pencil, Plus } from 'lucide-react';
import { Banner, Button, Card, CardHeader, DataTable, Facts, Mono, Pill, type Column } from '../../../../../components/mist';
import type { MistCommand, MistState } from '../../../../../server/src/shared/mistWorkspace';
import type { FulfillmentCustoms } from '../../../../../server/src/shared/mistFulfillment';
import { CUSTOMS_BRAND_TYPES, CUSTOMS_ELEMENT_LABELS, CUSTOMS_FAMILY_LABEL, CUSTOMS_PREFERENCES, customsItemsStale, defaultLegalUnits, draftCustomsDeclaration, readCustomsClassifications, type CustomsClassification, type CustomsDeclarationItem, type CustomsFamily } from '../../../../../server/src/shared/mistCustomsDeclaration';
import type { ModuleEditorSpec, ModuleValues } from './ModuleWorkbench';
import { field, text } from './fulfillmentKit';
import { ActionBar, DetailBlock, type ReasonedAction } from './pageKit';

const hsText = (hs: string) => hs.length === 10 ? `${hs.slice(0, 4)}.${hs.slice(4, 6)}.${hs.slice(6)}` : hs;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const elementKey = (i: number) => 'element' + i;

export function classificationSpec(family: CustomsFamily, run: (c: MistCommand) => Promise<unknown>, old?: CustomsClassification): ModuleEditorSpec {
  const labels = CUSTOMS_ELEMENT_LABELS[family], defaults = defaultLegalUnits(family === 'garment' ? '6203' : '5112');
  return {
    title: old ? `修改商品归类 ${old.code}` : `新建${CUSTOMS_FAMILY_LABEL[family]}商品归类`, submitLabel: old ? '保存修改' : '建立归类',
    description: family === 'garment' ? '服装归入第 61 章（针织）或第 62 章（机织）。货号在生成申报商品项时按款号自动填入。' : '面料归入第 50–60 章；规格写明幅宽与克重，如“幅宽150cm，克重280g/m²”。',
    fields: [
      { ...field('hsCode', '商品编号（10 位）'), hint: '按《进出口税则》与《规范申报目录》归类，以报关行确认的为准' },
      { ...field('declaredName', '申报品名'), hint: '中文规范名称，如“男式羊毛西服上衣”“全毛机织物”' },
      { ...field('styles', '适用款号'), hint: '多个款号用逗号分隔；出运明细按款号匹配归类' },
      field('brandType', '品牌类型', 'select', true, CUSTOMS_BRAND_TYPES.map(([v, l]) => ({ value: v, label: `${v} ${l}` }))),
      field('preference', '出口享惠情况', 'select', true, CUSTOMS_PREFERENCES.map(([v, l]) => ({ value: v, label: `${v} ${l}` }))),
      ...labels.map((label, i) => ({ ...field(elementKey(i), label), ...(label === '品牌' ? { hint: '无品牌填“无品牌”' } : label === '成分含量' ? { hint: '如“100%羊毛”“65%涤纶35%棉”' } : {}) })),
      { ...field('legalUnit', '法定第一单位', 'text', false), hint: `留空按编号默认（${family === 'garment' ? '西服套装为套，其他服装为件' : '机织面料为米，针织面料为千克'}）` },
      { ...field('secondUnit', '法定第二单位', 'text', false), hint: `一般为${defaults.secondUnit || '无'}；数量取装箱净重` },
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
    { key: 'code', header: '归类 / 商品编号', width: 'minmax(150px,1fr)', render: c => <div className="mist-col" style={{ gap: 2 }}><Mono>{hsText(c.hsCode)}</Mono><small className="mist-muted">{c.code}{c.voided ? ' · 已作废' : ''}</small></div> },
    { key: 'name', header: '申报品名', width: 'minmax(140px,1.2fr)', render: c => c.declaredName },
    { key: 'elements', header: '申报要素', hideOnMobile: true, render: c => <small>{[c.brandType, c.preference, ...c.elements].join('|')}</small> },
    { key: 'unit', header: '法定单位', width: '100px', hideOnMobile: true, render: c => c.secondUnit ? `${c.legalUnit} / ${c.secondUnit}` : c.legalUnit },
    { key: 'styles', header: '适用款号', width: 'minmax(120px,1fr)', render: c => c.styles.join('、') },
    ...(can ? [{ key: 'act', header: '', width: '150px', align: 'right' as const, render: (c: CustomsClassification) => c.voided ? <span className="mist-muted">{c.voided.reason}</span> : <span className="mist-row"><Button size="sm" icon={Pencil} disabled={locked} aria-label={`修改 ${c.code}`} onClick={() => open(classificationSpec(c.family, run, c))}>修改</Button><Button size="sm" icon={Ban} disabled={locked} aria-label={`作废 ${c.code}`} onClick={() => open(voidSpec(c))}>作废</Button></span> }] : []),
  ];
  return <div className="mist-section"><Card data-customs-classifications>
    <CardHeader title={`${CUSTOMS_FAMILY_LABEL[domain]}商品归类 · ${all.filter(c => !c.voided).length}`} sub="按款号建档一次，之后每票出运自动带出商品编号、申报品名、申报要素与法定单位。"
      tools={<span className="mist-row"><Button size="sm" onClick={() => setShowVoided(v => !v)}>{showVoided ? '隐藏已作废' : '显示已作废'}</Button>{can && <Button size="sm" variant="primary" icon={Plus} disabled={locked} onClick={() => open(classificationSpec(domain, run))}>新建归类</Button>}</span>} />
    <DataTable ariaLabel="商品归类库" rows={rows} rowKey={c => c.id} columns={columns} empty={all.length ? '没有符合条件的归类' : '尚未建立商品归类'} />
  </Card></div>;
}

export function CustomsItemsBlock({ record: c, state, can, locked, run, onClassify }: { record: FulfillmentCustoms; state: MistState; can: boolean; locked: boolean; run: (c: MistCommand) => Promise<unknown>; onClassify: () => void }) {
  const s = state.fulfillment.shipments.find(x => x.id === c.shipmentId);
  const draft = s ? draftCustomsDeclaration(state, s) : undefined;
  const items = c.items || [], stale = customsItemsStale(state, c);
  const closed = !s || s.state === 'departed' || s.state === 'cancelled';
  const reason = !can ? '需要报关单证权限' : c.status === 'cleared' ? '已放行的报关记录不可改动' : closed ? '出运已离港或已取消' : draft?.blockers.length ? '先处理下列问题' : false;
  const totals = new Map<string, number>(); for (const i of items) totals.set(i.currency, Math.round(((totals.get(i.currency) || 0) + i.amount) * 100) / 100);
  const columns: Column<CustomsDeclarationItem>[] = [
    { key: 'no', header: '项号', width: '52px', render: i => i.no },
    { key: 'hs', header: '商品编号', width: '120px', render: i => <Mono>{hsText(i.hsCode)}</Mono> },
    { key: 'name', header: '商品名称及规格型号', width: 'minmax(200px,2fr)', render: i => <div className="mist-col" style={{ gap: 2 }}><b>{i.declaredName}</b><small className="mist-muted">{i.elements}</small></div> },
    { key: 'qty', header: '数量及单位', width: 'minmax(120px,1fr)', render: i => <div className="mist-col" style={{ gap: 2 }}><span>{i.quantity} {i.unit}</span><small className="mist-muted">法定 {i.legalQty} {i.legalUnit}{i.secondUnit ? ` · ${i.secondQty ?? '—'} ${i.secondUnit}` : ''}</small></div> },
    { key: 'price', header: '单价 / 总价', width: '140px', align: 'right', render: i => <div className="mist-col" style={{ gap: 2 }}><span>{i.unitPrice}</span><b>{i.currency} {money(i.amount)}</b></div> },
  ];
  return <DetailBlock title="申报商品项" aside={items.length ? <span className="mist-muted">{c.itemsBy} · {c.itemsAt?.slice(0, 16).replace('T', ' ')}</span> : undefined}>
    {items.length > 0 ? <>
      {stale && c.status !== 'cleared' && <Banner tone="warn" title="出运或装箱已变化">已生成的商品项与当前出运明细、装箱或归类不一致，请重新生成后再交报关行。</Banner>}
      <DataTable ariaLabel={`${c.code} 申报商品项`} rows={items} rowKey={i => String(i.no)} columns={columns} />
      <Facts cols={4} items={[{ label: '件数', value: `${c.packages ?? 0} 件` }, { label: '毛重', value: `${c.grossWeight ?? 0} kg` }, { label: '净重', value: `${c.netWeight ?? 0} kg` }, { label: '总价', value: [...totals].map(([cur, n]) => `${cur} ${money(n)}`).join(' / ') }]} />
    </> : <span className="mist-note">尚未生成。按款号匹配商品归类，自动带出商品编号、申报品名、申报要素和法定数量；总价与 CI 同一算法，件数和重量取装箱合计。</span>}
    {c.status !== 'cleared' && draft && draft.blockers.length > 0 && <Banner tone="warn" title="还不能生成">{draft.blockers.join('；')}</Banner>}
    {can && c.status !== 'cleared' && <ActionBar busy={locked} actions={[
      { label: items.length ? '重新生成商品项' : '生成申报商品项', icon: ListChecks, primary: !items.length || stale, reason, onClick: () => void run({ type: 'fulfillment.customs.items', payload: { id: c.id } } as MistCommand) },
      { label: '维护商品归类', onClick: onClassify },
    ] as ReasonedAction[]} />}
    <span className="mist-note">本系统只准备申报资料，交报关行或在单一窗口录入；不代替海关申报。</span>
  </DetailBlock>;
}
