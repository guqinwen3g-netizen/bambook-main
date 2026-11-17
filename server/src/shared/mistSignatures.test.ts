import { describe, expect, it } from 'vitest';
import { mistCommandRequiresSignature, normalizeSignatureSvg, signatureEntityId, pendingSignatureReviewId, resolveReviewDecisionSignature, signatureReceiptFact } from './mistSignatures';
import { createMistState, getMistReviewTasks } from './mistWorkspace';
import { createOrderGovernance } from './mistOrderGovernance';
import { signatureSvg } from '../../../components/mist/SignaturePad';
import { TEST_SIGNATURE_SVG } from '../mist/__tests__/signature';

const approve = (type: string) => ({ type, payload: { id: 'x', decision: 'approved', note: 'ok' } });
const reject = (type: string) => ({ type, payload: { id: 'x', decision: 'rejected', note: 'no' } });
const invalid = { code: 'VALIDATION', status: 422, message: '签字无效，请重新签字' };

function historicalMain(count=2){
 const state=createMistState({id:()=>crypto.randomUUID(),now:'2026-11-18T04:00:00.000Z',actorName:'业务'},'empty');
 const rounds=Array.from({length:count},(_,index)=>({id:'round-'+index,kind:index?'change':'initial',status:'approved',requesterId:'sales',reviewerIds:['boss'],submittedAt:'2026-11-18T04:00:00.000Z',decidedBy:'boss',decidedName:'同名负责人',decidedAt:'2026-11-18T04:00:00.000Z',note:'核对',reason:'变更',snapshot:{orderId:'order-history',code:'SO-HISTORY',type:'garment',customerId:'client',customer:'客户',season:'AW',currency:'USD',due:'2026-12-'+String(index+10),contract:createOrderGovernance({id:()=>'',now:'',actorName:''}).contract,lines:[]}}));
 state.orders=[{id:'order-history',code:'SO-HISTORY',type:'garment',governance:{contract:rounds.at(-1)!.snapshot.contract,rounds,effectiveVersion:count,status:'approved',approvedBy:'boss',approvedSnapshot:structuredClone(rounds.at(-1)!.snapshot)}}] as any;
 state.decisionSignatures=rounds.map((_,index)=>({id:'sig-'+index,commandType:'order.governance.decide',entityId:'order-history',decision:'approved',fileId:'file-'+index,actorId:'boss',actor:'同名负责人',at:'2026-11-'+String(17-index)+'T09:00:00.000Z',requestId:'request-'+index}));
 const receipts=state.decisionSignatures.map((s,index)=>signatureReceiptFact(s,{requestId:s.requestId,actorId:s.actorId,expectedRevision:index*3,result:{revision:index*3+1,result:{signatureId:s.id}}}));
 return {state,tasks:getMistReviewTasks(state),receipts};
}

describe('exact approval signature identity',()=>{
 it('binds a command only to a unique real pending source and frozen reviewer roster',()=>{
  const f=historicalMain(1),task={...f.tasks[0],status:'pending' as const};
  expect(pendingSignatureReviewId([task],{...approve('order.governance.decide'),payload:{...approve('order.governance.decide').payload,id:task.entityId,reviewId:'forged'}},'boss')).toBe(task.id);
  expect(()=>pendingSignatureReviewId([task,{...task,id:'other'}],{type:'order.governance.decide',payload:{id:task.entityId,decision:'approved'}},'boss')).toThrow();
  expect(()=>pendingSignatureReviewId([task],{type:'order.governance.decide',payload:{id:task.entityId,decision:'approved'}},'unassigned')).toThrow();
  expect(()=>pendingSignatureReviewId([task],{type:'order.governance.decide',payload:{id:task.entityId,decision:'approved'}},'boss','forged')).toThrow();
 });
 it('reads distinct old main rounds from complete atomic append facts, not equal business or reversed audit clocks',()=>{
  const {state,tasks,receipts}=historicalMain(3),before=structuredClone(state);
  expect(tasks.map(t=>resolveReviewDecisionSignature(state,t,tasks,{receipts})?.fileId)).toEqual(['file-0','file-1','file-2']);
  expect(state).toEqual(before);expect(state.decisionSignatures!.every(s=>s.reviewId===undefined)).toBe(true);
 });
 it.each(['missing signature','missing receipt','wrong actor','outside roster','reversed signatures','reversed rounds','wrong version count','duplicate request','conflicting receipt'])('refuses unsafe legacy inference: %s',kind=>{
  const {state,tasks,receipts}=historicalMain(2);
  if(kind==='missing signature')state.decisionSignatures!.pop();
  if(kind==='missing receipt')receipts.pop();
  if(kind==='wrong actor')state.orders[0].governance!.rounds[0].decidedBy='another';
  if(kind==='outside roster')state.orders[0].governance!.rounds[0].reviewerIds=['another'];
  if(kind==='reversed signatures')state.decisionSignatures!.reverse();
  if(kind==='reversed rounds')state.orders[0].governance!.rounds.reverse();
  if(kind==='wrong version count')state.orders[0].governance!.effectiveVersion=3;
  if(kind==='duplicate request')state.decisionSignatures![1].requestId=state.decisionSignatures![0].requestId;
  if(kind==='conflicting receipt')receipts[0].reviewId=tasks[1].id;
  const fresh=getMistReviewTasks(state);expect(resolveReviewDecisionSignature(state,fresh[0],fresh,{receipts})).toBeUndefined();
 });
 it('prefers exact immutable review receipts even when a complete ordinal proof is unavailable',()=>{
  const {state,tasks,receipts}=historicalMain(2);receipts[0].reviewId=tasks[0].id;receipts[1].reviewId=tasks[1].id;state.orders[0].governance!.effectiveVersion=99;
  expect(resolveReviewDecisionSignature(state,tasks[0],tasks,{receipts})?.fileId).toBe('file-0');
  expect(resolveReviewDecisionSignature(state,tasks[1],tasks,{receipts})?.fileId).toBe('file-1');
 });
 it('never replaces conflicting explicit metadata by an ordinal guess',()=>{
  const {state,tasks,receipts}=historicalMain(2);state.decisionSignatures![0].reviewId=tasks[1].id;receipts[0].reviewId=tasks[0].id;
  expect(resolveReviewDecisionSignature(state,tasks[0],tasks,{receipts})).toBeUndefined();
 });
 it('retains legacy command order alongside a new exact bound round without backfilling old metadata',()=>{
  const {state,tasks,receipts}=historicalMain(3);state.decisionSignatures![2].reviewId=tasks[2].id;receipts[2].reviewId=tasks[2].id;
  const before=structuredClone(state);
  expect(tasks.map(t=>resolveReviewDecisionSignature(state,t,tasks,{receipts})?.fileId)).toEqual(['file-0','file-1','file-2']);
  expect(state).toEqual(before);expect(state.decisionSignatures![0].reviewId).toBeUndefined();
 });
 it('does not infer a legacy main sequence with a malformed frozen roster',()=>{
  const {state,tasks,receipts}=historicalMain(2);state.orders[0].governance!.rounds[0].reviewerIds=['boss','boss'];
  expect(resolveReviewDecisionSignature(state,tasks[0],tasks,{receipts})).toBeUndefined();
 });
 it('does not identify a legacy cancellation by an approver display name when actor ID is absent',()=>{
  const {state}=historicalMain(1);const order=state.orders[0];order.governance!.cancellation={id:'cancel',status:'approved',reason:'取消',requesterId:'sales',requesterName:'业务',reviewerIds:['boss'],requestedAt:'2026-11-18T04:00:00Z',decidedName:'同名负责人',decidedAt:'2026-11-18T04:00:00Z'};
  state.decisionSignatures=[{id:'cancel-signature',commandType:'order.governance.decide',entityId:order.id+'#cancel:cancel',decision:'approved',fileId:'cancel-file',actorId:'boss',actor:'同名负责人',at:'2026-11-17T09:00:00Z',requestId:'cancel-request'}];
  const tasks=getMistReviewTasks(state),task=tasks.find(t=>t.id==='order-cancel:cancel')!;expect(resolveReviewDecisionSignature(state,task,tasks)).toBeUndefined();
 });
 it.each(['signature','actor','request','revision','review'])('rejects a receipt with mismatched %s facts',field=>{
  const {state}=historicalMain(1),sig=state.decisionSignatures![0],receipt:any={requestId:sig.requestId,actorId:sig.actorId,expectedRevision:0,result:{revision:1,result:{signatureId:sig.id,reviewId:'order:round-0'}}};
  if(field==='signature')receipt.result.result.signatureId='other';if(field==='actor')receipt.actorId='other';if(field==='request')receipt.requestId='other';if(field==='revision')receipt.result.revision=0;if(field==='review')receipt.result.result.reviewId='';
  expect(signatureReceiptFact(sig,receipt).unresolved).toBe(true);
 });
});

describe('签字要求', () => {
  it.each(['order.governance.decide', 'fulfillment.procurement.decide', 'fulfillment.procurement.amend.decide', 'payable.request.decide', 'fulfillment.stock.count.decide'])('%s 仅批准需要签字', type => {
    expect(mistCommandRequiresSignature(approve(type))).toBe(true);
    expect(mistCommandRequiresSignature(reject(type))).toBe(false);
  });
  it('结算复核、退税核准始终需要；核销只在坏账与红冲更正时需要', () => {
    expect(mistCommandRequiresSignature({ type: 'payable.settlement.confirm', payload: { id: 's', prepaymentApplied: 0 } })).toBe(true);
    expect(mistCommandRequiresSignature({ type: 'rebate.claim.approve', payload: { id: 'r' } })).toBe(true);
    for (const kind of ['badDebt', 'correction']) expect(mistCommandRequiresSignature({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i', kind } })).toBe(true);
    expect(mistCommandRequiresSignature({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i', kind: 'difference' } })).toBe(false);
    expect(signatureEntityId({ type: 'finance.receivable.writeoff', payload: { invoiceId: 'i', kind: 'badDebt' } })).toBe('i');
  });
  it('其他审批与普通命令不需要', () => {
    for (const type of ['market.quotation.decide', 'platform.claim.decide', 'platform.risk.decide', 'fulfillment.qc.concession.decide', 'payable.settlement.return', 'rebate.claim.file', 'order.create', 'fulfillment.documents.issue'])
      expect(mistCommandRequiresSignature(approve(type))).toBe(false);
  });
});

describe('签字 SVG 规范化', () => {
  it('接受签字板的实际输出并按数值重新生成', () => {
    const pad = signatureSvg([[{ x: 40, y: 100, w: 2.7 }, { x: 60.04, y: 80, w: 2.2 }, { x: 90, y: 96, w: 1.8 }], [{ x: 200, y: 60, w: 3 }]]);
    const out = normalizeSignatureSvg(pad);
    expect(out).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="32 52 176 56" width="176" height="56" fill="none" stroke="#0E1A21"/);
    expect(out.match(/<path /g)).toHaveLength(2);
    expect(out).toContain('<circle cx="200" cy="60" r="1.5" fill="#0E1A21"/>');
    expect(normalizeSignatureSvg(out)).toBe(out);
    expect(normalizeSignatureSvg(TEST_SIGNATURE_SVG)).toContain('<path d="M60 90Q72.4 60.2 88.1 75.3" stroke-width="2.7"/>');
  });
  it.each([
    ['脚本', TEST_SIGNATURE_SVG.replace('</svg>', '<script>alert(1)</script></svg>')],
    ['链接', TEST_SIGNATURE_SVG.replace('<circle', '<a href="javascript:alert(1)"><circle').replace('</svg>', '</a></svg>')],
    ['外部引用', TEST_SIGNATURE_SVG.replace('<circle', '<use href="#x"/><circle')],
    ['事件属性', TEST_SIGNATURE_SVG.replace('stroke-width="2.70"/>', 'stroke-width="2.70" onload="x()"/>')],
    ['实体', '<!DOCTYPE svg [<!ENTITY x "y">]>' + TEST_SIGNATURE_SVG],
    ['其他标签', TEST_SIGNATURE_SVG.replace('<circle', '<image href="data:image/png;base64,AAAA"/><circle')],
    ['根属性', TEST_SIGNATURE_SVG.replace('fill="none"', 'fill="none" style="x"')],
    ['非数字路径', TEST_SIGNATURE_SVG.replace('M60.0 90.0', 'M60.0 90.0 L 1e9')],
    ['尾部文字', TEST_SIGNATURE_SVG + 'x'],
    ['空签字', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="#0E1A21" stroke-linecap="round" stroke-linejoin="round"></svg>'],
    ['空串', ''],
    ['非字符串', { svg: TEST_SIGNATURE_SVG }],
  ])('拒绝%s', (_label, input) => { expect(() => normalizeSignatureSvg(input)).toThrow(expect.objectContaining(invalid)); });
  it('拒绝超过 64 KB 或超过 4000 段的签字', () => {
    const seg = '<path d="M1 1Q2 2 3 3" stroke-width="1"/>';
    const head = TEST_SIGNATURE_SVG.slice(0, TEST_SIGNATURE_SVG.indexOf('<path'));
    expect(() => normalizeSignatureSvg(head + seg.repeat(4001) + '</svg>')).toThrow(expect.objectContaining(invalid));
    expect(() => normalizeSignatureSvg(head + seg.repeat(1700) + '</svg>')).toThrow(expect.objectContaining(invalid));
    expect(normalizeSignatureSvg(head + seg.repeat(1500) + '</svg>').match(/<path /g)).toHaveLength(1500);
  });
});
