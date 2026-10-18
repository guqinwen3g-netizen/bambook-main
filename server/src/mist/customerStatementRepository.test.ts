import {beforeEach,afterEach,expect,it,vi,describe} from 'vitest';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as contract from '../shared/mistWorkspace';
import {customerStatementContent,customerStatementsOf,statementAge} from '../shared/mistCustomerStatement';
import {MistRepository,type MistCommandRequest} from './repository';
import {MistPrivateFiles} from './files';
import {MemoryMistDatabase,testActor,testAuthority} from './__tests__/support';

vi.mock('./context',()=>({mistApprovalAuthority:async()=>({supplier:{},businessReviewerId:'leader'})}));

const now='2026-10-16T08:00:00.000Z';
const company={legalName:'杭州竹语服饰有限公司',englishName:'Hangzhou Bamboo Apparel Co., Ltd.',address:'杭州市西湖区 1 号',englishAddress:'',phone:'0571-1',email:'ar@example.com',taxId:'',customsCode:'',bankName:'中国银行杭州分行',bankAccount:'1234 5678',swift:'BKCHCNBJ910',defaultCurrency:'USD'};
let baseline=0,directory:string,db:MemoryMistDatabase,files:MistPrivateFiles,repo:MistRepository,workspaceId:string,revision=0;
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const htmls:string[]=[];
const renderPdf=vi.fn(async(html:string)=>{htmls.push(html);const pdf=Buffer.from('%PDF-1.4\n'+digest(Buffer.from(html))+'\n%%EOF');return {pdf,sha:digest(pdf),bytes:pdf.length,generatedAt:now,format:'A4'};});
const state=()=>db.workspaces.get(workspaceId).state as contract.MistState;
const names=async()=>(await readdir(path.join(directory,workspaceId)).catch(()=>[] as string[])).slice(baseline);
const exec=async(requestId:string,command:contract.MistCommand)=>{const r=await repo.execute(testActor(),workspaceId,{requestId,expectedRevision:revision,command} as MistCommandRequest);revision=r.workspace.revision;return r;};
const generate=(requestId:string,payload:Record<string,unknown>)=>exec(requestId,{type:'finance.statement.generate',payload} as never);

beforeEach(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'mist-soa-'));db=new MemoryMistDatabase();const auth=testAuthority();auth.users.get('owner')!.permissions=['invoices:read','invoices:write'];files=new MistPrivateFiles(directory);renderPdf.mockClear();htmls.length=0;revision=0;
 repo=new MistRepository(db,contract,files,auth.authorize,()=>new Date(now),undefined,renderPdf);workspaceId=(await repo.create(testActor(),{name:'对账单测试空间',seed:'demo'})).id;
 baseline=(await readdir(path.join(directory,workspaceId)).catch(()=>[] as string[])).length;
 const s=state();s.settings.companyProfile={...company};
 // 客户 1 有一笔同名付款方的待核销到账
 const c1=s.customers.find(c=>c.id==='customer-1')!;s.receipts.push({id:'r-adv',code:'BR-ADV-1',date:'2026-10-12',payer:c1.name.toUpperCase(),amount:3000,remaining:3000,currency:'USD',ref:'TT ADV',state:'unmatched'});
 s.receipts.push({id:'r-future',code:'BR-FUT-1',date:'2026-10-20',payer:c1.name,amount:500,remaining:500,currency:'USD',ref:'',state:'unmatched'});
});
afterEach(async()=>{vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});});

describe('客户对账单',()=>{
 it('按币种列未结应收、同名待核销到账、账龄与净欠款，冻结快照并归档 PDF',async()=>{
  await generate('soa-1',{customerId:'customer-1'});
  const [rec]=customerStatementsOf(state(),'customer-1');
  expect(rec).toMatchObject({statementNo:'SOA-2026-0001',seq:1,asOf:'2026-10-16',customerId:'customer-1'});
  const sec=rec.snapshot.sections;expect(sec.map(s=>s.currency)).toEqual(['USD']);
  expect(sec[0].lines.map(l=>l.code)).toEqual(['INV-G-2026-0398','INV-G-2026-0405','CI-2026-0417']); // 按到期日排序
  expect(sec[0].lines[0]).toMatchObject({daysOverdue:11,bucket:'1-30'});
  expect(sec[0].unapplied.map(u=>u.code)).toEqual(['BR-ADV-1']); // 对账日之后的到账不列入
  expect(sec[0]).toMatchObject({totalOpen:'62325.00',totalUnapplied:'3000.00',net:'59325.00'});
  expect(rec.totals).toEqual([{currency:'USD',net:'59325.00'}]);
  expect(sec[0].aging.reduce((n,a)=>n+Number(a.amount),0)).toBeCloseTo(62325);
  expect(sec[0].remit[0]).toMatchObject({accountNo:expect.any(String)});
  const html=htmls[0];expect(html).toContain('STATEMENT OF ACCOUNT');expect(html).toContain('SOA-2026-0001');expect(html).toContain('INV-G-2026-0398');expect(html).toContain('BR-ADV-1');expect(html).not.toContain('BR-FUT-1');expect(html).toContain('59,325.00');
  const f=state().files.find(x=>x.id===rec.fileId)!;expect(f).toMatchObject({mimeType:'application/pdf'});expect(f.name).toContain('SOA-2026-0001');
  expect((await files.read(workspaceId,f)).subarray(0,8).toString()).toBe('%PDF-1.4');expect(await names()).toHaveLength(1);
  expect(state().events.some(e=>e.entityType==='invoice'&&e.entityId==='customer-1'&&e.text.includes('SOA-2026-0001'))).toBe(true);
  await generate('soa-2',{customerId:'customer-0'});
  expect(customerStatementsOf(state(),'customer-0')[0].statementNo).toBe('SOA-2026-0002');
  const replay=await repo.execute(testActor(),workspaceId,{requestId:'soa-2',expectedRevision:revision-1,command:{type:'finance.statement.generate',payload:{customerId:'customer-0'}}} as never);
  expect(replay.replayed).toBe(true);expect(renderPdf).toHaveBeenCalledTimes(2);
 });
 it('已结清客户、缺公司抬头、伪造内容与过期版本在渲染前拒绝',async()=>{
  const before=structuredClone(state());
  await expect(generate('settled',{customerId:'customer-2'})).rejects.toMatchObject({status:422});
  await expect(generate('forged',{customerId:'customer-1',sections:[]})).rejects.toMatchObject({status:422});
  await expect(generate('missing',{customerId:'nope'})).rejects.toMatchObject({status:404});
  expect(renderPdf).not.toHaveBeenCalled();expect(state()).toEqual(before);expect(await names()).toHaveLength(0);
  await generate('ok',{customerId:'customer-1'});renderPdf.mockClear();
  await expect(repo.execute(testActor(),workspaceId,{requestId:'stale',expectedRevision:0,command:{type:'finance.statement.generate',payload:{customerId:'customer-0'}}} as never)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  expect(renderPdf).not.toHaveBeenCalled();
  state().settings.companyProfile={...company,legalName:''};
  await expect(generate('no-issuer',{customerId:'customer-0'})).rejects.toMatchObject({status:422});
 });
 it('渲染失败不落库，可重试；没有写权限不能生成',async()=>{
  const before=structuredClone(state());renderPdf.mockRejectedValueOnce(new Error('down'));
  await expect(generate('fail',{customerId:'customer-0'})).rejects.toMatchObject({code:'CUSTOMER_STATEMENT_PDF_UNAVAILABLE'});
  expect(state()).toEqual(before);expect(await names()).toHaveLength(0);
  await generate('retry',{customerId:'customer-0'});expect(customerStatementsOf(state(),'customer-0')).toHaveLength(1);
  expect(contract.mistCommandPermission({type:'finance.statement.generate',payload:{customerId:'x'}} as never)).toBe('invoices:write');
 });
 it('账龄分段与贷项抵扣',()=>{
  expect(statementAge('2026-10-16','2026-10-16')).toEqual({days:0,bucket:'not-due'});
  expect(statementAge('2026-09-15','2026-10-16')).toEqual({days:31,bucket:'31-60'});
  expect(statementAge('','2026-10-16')).toEqual({days:null,bucket:'unknown'});
  const s=structuredClone(state());s.platform.creditApplications.push({id:'ca',creditId:'cn',invoiceId:'INV-G-2026-0412',amount:240,at:now,actor:'财务'});
  const line=customerStatementContent(s,'customer-0','2026-10-16').sections[0].lines[0];
  expect(line).toMatchObject({code:'INV-G-2026-0412',credited:'240.00',open:'42240.00'});
 });
});
