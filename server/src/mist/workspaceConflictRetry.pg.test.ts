import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
