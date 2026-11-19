import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { MistPrivateFiles } from './files';
import { MistRepository } from './repository';
import * as actualContract from '../shared/mistWorkspace';
import { MIST_READ_SECTIONS } from './access';
import {fixture as shipmentFixture} from './__tests__/professionalFulfillment';
import { testActor, testAuthority, testContract } from './__tests__/support';

/**
 * 真实 PostgreSQL 并发回归：只在显式提供独立测试库时运行，避免误连共享或生产库。
 *   MIST_PG_CONFLICT_TEST_URL=postgresql://... npx vitest run src/mist/workspaceConflictRetry.pg.test.ts
 * 库结构需与 prisma/schema.prisma 一致；用例只清理自己创建的公司与回执。
 */
const url = process.env.MIST_PG_CONFLICT_TEST_URL;
describe.skipIf(!url)('真实 PostgreSQL：多人同时保存自动重试', () => {
  let prisma: PrismaClient, root: string, repo: MistRepository, files: MistPrivateFiles;
  const owner = testActor('owner'), ids: string[] = [];
  beforeAll(async () => { prisma = new PrismaClient({ datasourceUrl: url }); root = await mkdtemp(path.join(tmpdir(), 'mist-pg-retry-')); files = new MistPrivateFiles(root); repo = new MistRepository(prisma, testContract, files, testAuthority().authorize); });
  afterAll(async () => {
    if (ids.length) { await prisma.mistCommandReceipt.deleteMany({ where: { workspaceId: { in: ids } } }); await prisma.mistWorkspace.deleteMany({ where: { id: { in: ids } } }); }
    await prisma?.$disconnect(); await rm(root, { recursive: true, force: true });
  });
  const workspace = async () => { const created = await repo.create(owner, { name: 'PG 并发', slug: 'pg-retry-' + Math.random().toString(36).slice(2), seed: 'empty' }); ids.push(created.id); return created.id; };
  const note = (requestId: string, text = requestId) => ({ requestId, expectedRevision: 0, command: { type: 'notes.add', payload: { text } } });
  const row = (id: string) => prisma.mistWorkspace.findUniqueOrThrow({ where: { id } }) as any;
  const requests = (id: string) => prisma.mistCommandReceipt.count({ where: { workspaceId: id, NOT: { requestId: { startsWith: 'mist-revision:' } } } });

  it.each(['review', 'review-note', 'regenerated', 'unrelated'] as const)('binds CD issue to its reviewed source and original (%s)', async change => {
    const auth = testAuthority(), permissions = [...new Set(MIST_READ_SECTIONS.flatMap(section => section.permissions)), 'customs:write', 'shipments:write', 'relations:write'];
    auth.users.get('owner')!.permissions = permissions; auth.users.get('other')!.permissions = permissions;
    // PDF layout is tested separately; use a deterministic archive to exercise real file writes and PG receipts.
    const render = async () => { const pdf = Buffer.from('%PDF-1.4\nCD concurrency fixture\n%%EOF'); return { pdf, sha: createHash('sha256').update(pdf).digest('hex'), bytes: pdf.length, generatedAt: new Date().toISOString(), format: 'A4' }; };
    const actual = new MistRepository(prisma, actualContract, files, auth.authorize, undefined, undefined, render);
    const created = await actual.create(owner, { name: 'CD source', slug: 'pg-cd-source-' + Math.random().toString(36).slice(2), seed: 'empty' }); ids.push(created.id);
    const f = shipmentFixture(), branch = f.released(); f.receiveAndComplete(branch.productionId, branch.purchaseId);
    const shipmentId = f.shipment(branch.productionId), line = f.state.orderLines[0], source = f.state.fulfillment.shipments.find(s => s.id === shipmentId)!.lines[0];
    f.state.settings.companyProfile = { legalName: '竹语服饰', englishName: 'Bamboo Apparel', address: '杭州', englishAddress: 'Hangzhou', phone: '0571-1', email: 'doc@example.invalid', taxId: 'TAX-1', customsCode: 'CUS-1', bankName: 'Bank', bankAccount: '123', swift: 'SWIFT', defaultCurrency: 'USD' };
    f.run({ type: 'fulfillment.shipments.pack', payload: { id: shipmentId, lines: [{ lineId: line.id, productionId: source.productionId, carton: 'C1', quantity: 10, netWeight: 5, grossWeight: 6, volume: .5, note: '' }] } });
    const customsId = f.run({ type: 'fulfillment.customs.save', payload: { shipmentId, status: 'draft', declarationNo: '', broker: '报关行', hsCode: '', origin: '中国', tradeMode: '一般贸易', declaredAt: '', clearedAt: '', evidence: '', fileIds: [], note: '' } }).id!;
    f.run({ type: 'fulfillment.customs.classify.save', payload: { family: 'garment', hsCode: '6203310000', declaredName: '男式羊毛西服上衣', brandType: '0', preference: '0', elements: ['机织', '西服上衣', '男式', '100%羊毛', '无品牌'], styles: [line.style], legalUnit: '件', secondUnit: '千克' } });
    f.run({ type: 'fulfillment.customs.items', payload: { id: customsId } });
    const state = structuredClone(f.state); state.memberIds = ['other'];
    await prisma.mistWorkspace.update({ where: { id: created.id }, data: { state: JSON.parse(JSON.stringify(state)) } });
    const generate = { type: 'fulfillment.documents.generate' as const, payload: { shipmentId, type: 'CD' as const } };
    const printed = await actual.execute(owner, created.id, { requestId: 'cd-original', expectedRevision: 0, command: generate });
    const cd = printed.workspace.state.fulfillment.documents.find(d => d.type === 'CD')!, customs = printed.workspace.state.fulfillment.customs.find(c => c.id === customsId)!, item = customs.items![0];
    const issue = { requestId: 'cd-issue-reviewed', expectedRevision: 1, command: { type: 'fulfillment.documents.issue' as const, payload: { id: cd.id } } };
    const update = change === 'unrelated' ? { type: 'contact.save', payload: { customerId: state.customers[0].id, name: '新联系人', role: '收货', email: '', phone: '' } }
      : change === 'review-note' ? { type: 'fulfillment.customs.save', payload: { id: customs.id, shipmentId, status: 'draft', declarationNo: customs.declarationNo, broker: customs.broker, hsCode: customs.hsCode, origin: customs.origin, tradeMode: customs.tradeMode, declaredAt: '', clearedAt: '', evidence: '', fileIds: customs.fileIds, note: '审单确认已更新' } }
      : { type: 'fulfillment.customs.item.adjust', payload: { id: customsId, no: 1, declaredName: '男式机织羊毛西服上衣', elements: item.elements, legalQty: item.legalQty, secondQty: item.secondQty, reason: '据供方及审单原件补明品名' } };
    await actual.execute(testActor('other'), created.id, { requestId: 'cd-source-change', expectedRevision: 1, command: update } as any);
    if (change === 'regenerated') await actual.execute(testActor('other'), created.id, { requestId: 'cd-current-original', expectedRevision: 2, command: generate });
    let before = await row(created.id), receipts = await requests(created.id), disk = await readdir(root, { recursive: true });
    // Issue commands deliberately do not rebase, including after an unrelated update.
    // The page may use the new checked revision only after proving its CD source is unchanged.
    {
      await expect(actual.execute(owner, created.id, issue)).rejects.toMatchObject({ code: 'REVISION_CONFLICT', status: 409 });
      expect(await row(created.id)).toEqual(before); expect(await requests(created.id)).toBe(receipts); expect(await readdir(root, { recursive: true })).toEqual(disk);
    }
    if (change === 'review') {
      await expect(actual.execute(owner, created.id, { ...issue, requestId: 'cd-still-stale', expectedRevision: before.revision })).rejects.toMatchObject({ status: 422 });
      expect(await row(created.id)).toEqual(before); expect(await requests(created.id)).toBe(receipts); expect(await readdir(root, { recursive: true })).toEqual(disk);
      return;
    }
    const checked = { ...issue, requestId: 'cd-issue-rechecked', expectedRevision: before.revision };
    const issued = await actual.execute(owner, created.id, checked);
    expect(issued.workspace.state.fulfillment.documents.find(d => d.id === cd.id)!.status).toBe('issued');
    before = await row(created.id); const replay = await actual.execute(owner, created.id, checked);
    expect(replay.replayed).toBe(true); expect(replay.receipt).toEqual(issued.receipt); expect(await row(created.id)).toEqual(before); expect(await requests(created.id)).toBe(receipts + 1);
  });

  it('persists acceptance-based confirmation, rejects missing or premature facts without receipts, and replays once',async()=>{
    const auth=testAuthority(),all=[...new Set(MIST_READ_SECTIONS.flatMap(section=>section.permissions)),'invoices:write'];auth.users.get('owner')!.permissions=all;
    const actual=new MistRepository(prisma,actualContract,files,auth.authorize),created=await actual.create(owner,{name:'Acceptance AR',slug:'pg-acceptance-'+Math.random().toString(36).slice(2),seed:'empty'});ids.push(created.id);
    const f=shipmentFixture(),branch=f.released();f.receiveAndComplete(branch.productionId,branch.purchaseId);const shipmentId=f.shipment(branch.productionId),state=structuredClone(f.state),order=state.orders.find(o=>o.id===f.orderId)!,shipment=state.fulfillment.shipments.find(s=>s.id===shipmentId)!;
    const condition={kind:'deliveryAcceptance' as const,days:30,terms:'\u4ea4\u4ed8\u9a8c\u6536\u540e30\u5929\u4ed8\u6b3e'};Object.assign(order.governance!.contract,{paymentMethod:'OA',paymentNote:condition.terms});if(order.governance!.approvedSnapshot)order.governance!.approvedSnapshot.contract=structuredClone(order.governance!.contract);state.settings.businessClock={mode:'fixed',timezone:'Asia/Shanghai',at:'2026-10-22T04:00:00.000Z'};state.memberIds=['owner'];
    state.fulfillment.documents.push({id:'acceptance-ci',shipmentId,orderId:order.id,type:'CI',number:'CI-ACCEPTANCE',version:1,title:'CI',dueDate:'',content:condition.terms,fileIds:['contract'],status:'issued',createdAt:f.context.now,actor:'ops',invoiceId:'acceptance-ar',receivableDueCondition:condition});
    state.invoices.push({id:'acceptance-ar',code:'CI-ACCEPTANCE',orderId:order.id,order:order.code,customer:order.customer,currency:order.currency,amount:100,open:0,due:'',financeStatus:'pending',sourceDocumentId:'acceptance-ci',receivableDueCondition:condition});shipment.state='departed';shipment.departedAt='2026-10-19T04:00:00.000Z';
    await prisma.mistWorkspace.update({where:{id:created.id},data:{state:state as any}});const before=await row(created.id),initialRequests=await requests(created.id);
    await expect(actual.execute(owner,created.id,{requestId:'acceptance-no-pod',expectedRevision:0,command:{type:'finance.receivable.due',payload:{invoiceId:'acceptance-ar',acceptanceDate:'2026-10-21',acceptanceBasis:'AC1'}}})).rejects.toMatchObject({status:422});expect(await row(created.id)).toEqual(before);expect(await requests(created.id)).toBe(initialRequests);
    shipment.delivered={at:'2026-10-20T10:00:00.000Z',receiver:'Customer',evidence:'POD1',fileIds:[],recordedBy:'ops'};await prisma.mistWorkspace.update({where:{id:created.id},data:{state:state as any}});const delivered=await row(created.id);
    await expect(actual.execute(owner,created.id,{requestId:'acceptance-too-early',expectedRevision:0,command:{type:'finance.receivable.due',payload:{invoiceId:'acceptance-ar',acceptanceDate:'2026-10-19',acceptanceBasis:'AC1'}}})).rejects.toMatchObject({status:422});expect(await row(created.id)).toEqual(delivered);expect(await requests(created.id)).toBe(initialRequests);
    const amountConfirmed=await actual.execute(owner,created.id,{requestId:'acceptance-amount-reviewed',expectedRevision:0,command:{type:'finance.receivable.confirm',payload:{invoiceId:'acceptance-ar'}}});expect(amountConfirmed.workspace.state.invoices.find(i=>i.id==='acceptance-ar')).toMatchObject({financeStatus:'confirmed',open:100,due:''});
    const input={requestId:'acceptance-confirmed',expectedRevision:0,command:{type:'finance.receivable.due' as const,payload:{invoiceId:'acceptance-ar',acceptanceDate:'2026-10-21',acceptanceBasis:'Customer AC1 and POD1'}}};const amountRow=await row(created.id);await expect(actual.execute(owner,created.id,input)).rejects.toMatchObject({status:409});expect(await row(created.id)).toEqual(amountRow);const freshInput={...input,requestId:'acceptance-due-rechecked',expectedRevision:1};const result=await actual.execute(owner,created.id,freshInput);expect(result.workspace.state.invoices.find(i=>i.id==='acceptance-ar')).toMatchObject({financeStatus:'confirmed',open:100,due:'2026-11-20',dueConfirmation:{acceptanceDate:'2026-10-21',actorId:owner.userId,shipmentId}});expect(result.workspace.state.fulfillment.documents.find(d=>d.id==='acceptance-ci')!.dueDate).toBe('');
    const committed=await row(created.id),replayed=await actual.execute(owner,created.id,freshInput);expect(replayed.replayed).toBe(true);expect(replayed.receipt).toEqual(result.receipt);expect(await row(created.id)).toEqual(committed);expect(await requests(created.id)).toBe(initialRequests+2);
  });

  it.each([true,false])('checks a QC report physical source without refusing unrelated merging (related %s)',async related=>{
    const auth=testAuthority(),all=[...new Set(MIST_READ_SECTIONS.flatMap(section=>section.permissions)),'orders:write','products:write','relations:write','qc:garment_chain:write'];auth.users.get('owner')!.permissions=all;auth.users.get('other')!.permissions=all;
    const repo=new MistRepository(prisma,actualContract,files,auth.authorize),created=await repo.create(owner,{name:'QC source',slug:'pg-qc-source-'+Math.random().toString(36).slice(2),seed:'empty'}),f=shipmentFixture(),branch=f.released();ids.push(created.id);
    const source={kind:'orderLine' as const,orderId:f.orderId,lineId:f.state.orderLines[0].id,productionId:branch.productionId};
    const sampleId=f.run({type:'fulfillment.samples.create',payload:{name:'复核产前样',category:'成衣',form:'产前样',quantity:1,unit:'件',size:'M',color:'蓝',location:'样品室',source,role:'pp',fileIds:[],note:'独立物理样品'}}).id!;
    const taskId=f.run({type:'fulfillment.qc.request',payload:{source,sampleId,domain:'garment',kind:'sample',factory:'工厂',location:'样品室',contact:'',due:'2026-10-13'}}).id!;
    f.run({type:'fulfillment.qc.claim',payload:{id:taskId,domain:'garment'}},{...f.context,actorId:'owner',actorName:'QC'});
    const state=structuredClone(f.state);state.memberIds=['other'];state.settings.businessClock={mode:'fixed',at:f.context.now,timezone:'Asia/Shanghai'};await prisma.mistWorkspace.update({where:{id:created.id},data:{state:JSON.parse(JSON.stringify(state))}});
    const change=related?{type:'fulfillment.samples.edit',payload:{...state.fulfillment.samples.find(sample=>sample.id===sampleId),id:sampleId,color:'红'}}:{type:'contact.save',payload:{customerId:state.customers[0].id,name:'新联系人',role:'收货',email:'',phone:''}};
    await repo.execute(testActor('other'),created.id,{requestId:'concurrent-qc-source',expectedRevision:0,command:change}as any);
    if(related)expect((await row(created.id)).state.fulfillment.samples.find((sample:any)=>sample.id===sampleId).qualityRevision).toBe(2);
    const command={type:'fulfillment.qc.report',payload:{id:taskId,domain:'garment',result:'pass',report:'QC-OLD-PHYSICAL',opinion:'原蓝色样品测量',measurements:[{point:'胸围',standard:100,actual:100.2,tolerance:1}],fileIds:[],reviewedAt:f.context.now}}as any;
    const before=await row(created.id),receipts=await requests(created.id);
    if(!related){const merged=await repo.execute(owner,created.id,{requestId:'old-qc-report',expectedRevision:0,command});expect(merged.receipt.revision).toBe(2);return;}
    await expect(repo.execute(owner,created.id,{requestId:'old-qc-report',expectedRevision:0,command})).rejects.toMatchObject({code:'REVISION_CONFLICT',status:409});
    expect(await row(created.id)).toEqual(before);expect(await requests(created.id)).toBe(receipts);
    const fresh=await repo.execute(owner,created.id,{requestId:'checked-qc-report',expectedRevision:1,command:{...command,payload:{...command.payload,report:'QC-CURRENT-PHYSICAL',opinion:'重新核对当前红色实物'}}});
    expect(fresh.workspace.state.fulfillment.qcReports.find((report:any)=>report.report==='QC-CURRENT-PHYSICAL').scopeRevision).toBe(2);
  });

  it.each([['save',true],['save',false],['sourceTerms',true],['sourceTerms',false]] as const)('checks shipment %s read sources while preserving unrelated merging (related %s)',async(kind,related)=>{
    const auth=testAuthority(),all=[...new Set(MIST_READ_SECTIONS.flatMap(section=>section.permissions)),'orders:write','shipments:write','relations:write','products:write'];auth.users.get('owner')!.permissions=all;auth.users.get('other')!.permissions=all;
    const repo=new MistRepository(prisma,actualContract,files,auth.authorize),created=await repo.create(owner,{name:'Shipment source',slug:'pg-shipment-'+Math.random().toString(36).slice(2),seed:'empty'}),f=shipmentFixture();let command:any;
    if(kind==='save'){
      const branch=f.released();f.receiveAndComplete(branch.productionId,branch.purchaseId);const id=f.shipment(branch.productionId),s=f.state.fulfillment.shipments.find(row=>row.id===id)!;
      command={type:'fulfillment.shipments.save',payload:{...s,note:'已核对本次出运要求'}};
    }else{
      f.approveOrder();command={type:'fulfillment.shipments.sourceTerms',payload:{orderId:f.orderId,consignee:'客户收货仓',partialAllowed:true,mode:'sea',confirmedAt:'2026-10-13',evidence:'已签合同'}};
    }
    const state=structuredClone(f.state);state.memberIds=['other'];await prisma.mistWorkspace.update({where:{id:created.id},data:{state:JSON.parse(JSON.stringify(state))}});ids.push(created.id);
    const change=related?(kind==='save'?{type:'production.update',payload:{id:state.productions[0].id,pct:state.productions[0].pct,risk:'待复核出运安排'}}:{type:'order.checklist',payload:{orderId:f.orderId,itemId:state.orders[0].checklist[0].id,done:true}}):{type:'contact.save',payload:{customerId:state.customers[0].id,name:'新联系人',role:'收货',email:'',phone:''}};
    await repo.execute(testActor('other'),created.id,{requestId:'concurrent-change',expectedRevision:0,command:change}as any);
    const before=await row(created.id),receipts=await requests(created.id);
    if(!related){const merged=await repo.execute(owner,created.id,{requestId:'old-shipment',expectedRevision:0,command});expect(merged.receipt.revision).toBe(2);return;}
    await expect(repo.execute(owner,created.id,{requestId:'old-shipment',expectedRevision:0,command})).rejects.toMatchObject({code:'REVISION_CONFLICT',status:409});
    expect(await row(created.id)).toEqual(before);expect(await requests(created.id)).toBe(receipts);
    const fresh=await repo.execute(owner,created.id,{requestId:'checked-shipment',expectedRevision:1,command});expect(fresh.receipt.revision).toBe(2);
  });

  it('rejects a stale physical stock count instead of reading a newer book balance; a rechecked count succeeds', async () => {
    const auth=testAuthority(),all=[...new Set(MIST_READ_SECTIONS.flatMap(section=>section.permissions)),'inventory:write'];auth.users.get('owner')!.permissions=all;auth.users.get('other')!.permissions=all;
    const actual=new MistRepository(prisma,actualContract,files,auth.authorize),created=await actual.create(owner,{name:'Physical count',slug:'pg-count-'+Math.random().toString(36).slice(2),seed:'demo'});ids.push(created.id);
    const state=(await row(created.id)).state,line=state.orderLines[0];state.memberIds=['other'];state.fulfillment.stock=[{id:'count-stock',sourceKind:'other',orderId:line.orderId,lineId:line.id,name:'Buttons',unit:'个',quantity:12,available:12,location:'A',owner:'Company',createdAt:'2026-11-18T04:00:00Z',otherReceipt:{reason:'other',source:'DN1',evidence:'Counted'}}];await prisma.mistWorkspace.update({where:{id:created.id},data:{state}});
    await actual.execute(testActor('other'),created.id,{requestId:'move-before-count',expectedRevision:0,command:{type:'fulfillment.inventory.move',payload:{id:'count-stock',kind:'move',quantity:1,location:'B',person:'other',note:'Physical move'}}}as any);
    const input={requestId:'old-count',expectedRevision:0,command:{type:'fulfillment.stock.count',payload:{lines:[{stockId:'count-stock',location:'A',counted:11},{stockId:'count-stock',location:'B',counted:1}],note:'Physical count'}}}as any,before=await row(created.id),receipts=await requests(created.id);
    await expect(actual.execute(owner,created.id,input)).rejects.toMatchObject({code:'REVISION_CONFLICT',status:409});expect(await row(created.id)).toEqual(before);expect(await requests(created.id)).toBe(receipts);
    const fresh=await actual.execute(owner,created.id,{...input,requestId:'fresh-count',expectedRevision:1});expect(fresh.workspace.state.fulfillment.stockCounts.at(-1)).toMatchObject({state:'approved',lines:[{book:11,counted:11,difference:0},{book:1,counted:1,difference:0}]});
  });

  it('两人基于同一版本同时保存不同记录：两条都保留', async () => {
    const id = await workspace();
    await prisma.mistWorkspace.update({ where: { id }, data: { state: { ...(await row(id)).state, memberIds: ['other'] } } });
    const [a, b] = await Promise.all([repo.execute(owner, id, note('甲')), repo.execute(testActor('other'), id, note('乙'))]);
    expect([a.receipt.revision, b.receipt.revision].sort()).toEqual([1, 2]);
    const saved = await row(id); expect(saved.revision).toBe(2); expect(saved.state.notes.map((n: any) => n.text).sort()).toEqual(['乙', '甲'].sort());
  });

  it('同一版本上同时新增不同记录：全部保留或明确冲突，不丢失已确认的保存', async () => {
    const id = await workspace();
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => repo.execute(owner, id, note('n' + i))));
    const ok = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'REVISION_CONFLICT', status: 409 });
    const saved = await row(id);
    expect(ok.length).toBeGreaterThanOrEqual(2);
    expect(saved.revision).toBe(ok.length);
    expect(saved.state.notes.map((n: any) => n.text).sort()).toEqual(ok.map(r => r.value.receipt.requestId).sort());
    expect(await requests(id)).toBe(ok.length + 1);
  });

  it('同时修改同一字段：只有一个成功，另一个明确冲突且不覆盖', async () => {
    const id = await workspace();
    const results = await Promise.allSettled([5, 7].map(cents => repo.execute(owner, id, { requestId: 'm' + cents, expectedRevision: 0, command: { type: 'money.add', payload: { cents } } })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'REVISION_CONFLICT' });
    const saved = await row(id); expect(saved.revision).toBe(1); expect([5, 7]).toContain(saved.state.money.cents);
  });

  it('同一请求同时提交两次：只执行一次，两次都拿到同一回执', async () => {
    const id = await workspace();
    const [a, b] = await Promise.all([repo.execute(owner, id, note('same')), repo.execute(owner, id, note('same'))]);
    expect(a.receipt).toEqual(b.receipt); expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect((await row(id)).state.notes).toHaveLength(1); expect(await requests(id)).toBe(2);
  });

  it('附件同时上传：每个成功请求恰好一个文件，失败的不残留', async () => {
    const id = await workspace();
    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => repo.upload(owner, id, { requestId: 'f' + i, expectedRevision: 0 }, { name: `f${i}.txt`, mimeType: 'text/plain', bytes: Buffer.from('x' + i) })));
    const ok = results.filter(r => r.status === 'fulfilled').length, saved = await row(id);
    expect(saved.state.files).toHaveLength(ok); expect(await readdir(path.join(root, id)).catch(() => [])).toHaveLength(ok);
  });
});
