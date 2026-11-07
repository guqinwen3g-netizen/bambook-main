import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createMistState,applyMistCommand,mistCommandPermission} from '../shared/mistWorkspace';
import {SYSTEM_ROLE_IDS} from '../_shared/rolePermissionMatrix';
import {MemoryMistDatabase,testAuthority} from './__tests__/support';import {MistRepository} from './repository';import {MistPrivateFiles} from './files';
import {agentCatalog,agentGet,agentQuery} from './agentRead';
let directory:string,db:MemoryMistDatabase,repo:MistRepository,auth:ReturnType<typeof testAuthority>,workspaceId:string;
const company='11111111-1111-4111-8111-111111111111',now='2026-11-07T00:06:00Z';
const actorWith=(role:string):any=>({userId:'clerk',displayName:'Clerk',roleIds:[role+'@'+company],roles:[],companyId:company,authorizationLoaded:true});
beforeEach(async()=>{
 vi.spyOn(Date,'now').mockReturnValue(Date.parse(now));directory=await mkdtemp(path.join(tmpdir(),'mist-agent-finance-'));db=new MemoryMistDatabase();auth=testAuthority();auth.users.set('clerk',{active:true,permissions:['ai:chat','invoices:read','vouchers:read','vouchers:write','customs:read','procurement:read','products:read','reports:read','tax:read']});db.companyMembers.push({companyId:company,userId:'clerk',status:'active'});
 const state=createMistState({id:randomUUID,now,actorId:'clerk',actorName:'Clerk'},'empty');Object.assign(state as any,{receipts:[{id:'r1',code:'RC-1',amount:1200,currency:'USD'}],allocations:[{id:'a1',receiptId:'r1',amount:1200}],
  periodCloses:[{month:'2026-09',closedAt:'2026-10-02T00:00:00Z',closedBy:'clerk',note:'ok'},{month:'2026-10',closedAt:'2026-11-02T00:00:00Z',closedBy:'clerk',note:'ok',reopened:{at:'2026-11-03T00:00:00Z',actor:'clerk',reason:'fix'}}],
  bankAccounts:[{id:'b1',code:'BA-1',name:'USD main',bankName:'Test Bank',accountNo:'6222 0000 1234 5678',currency:'USD',openingBalance:0}],fxRecords:[{id:'fx1',kind:'lock',currency:'USD',amount:500}],
  letterOfCredits:[{id:'lc1',code:'LC-1',lcNo:'LC778'}],rfqs:[{id:'rfq1',code:'RFQ-1'}],sampleRequests:[{id:'sr1',code:'SR-1'}],exportRebate:{rates:[{id:'rt1',hsCode:'6203',rate:'0.13'}],claims:[{id:'cl1',code:'RB-1',customsId:'c1',lines:[],taxable:50000,expected:6500,receipts:[],approved:{amount:6400,date:'2026-11-01',ref:'AP1'}}]},reportSchedules:[{id:'rs1',name:'Weekly',ownerId:'clerk'},{id:'rs2',name:'Other',ownerId:'someone'}]});
 workspaceId=randomUUID();db.workspaces.set(workspaceId,{id:workspaceId,ownerId:'other',companyId:company,slug:'company@'+company,name:'Company',revision:4,state,createdAt:new Date(),updatedAt:new Date()});repo=new MistRepository(db,{createMistState,applyMistCommand,mistCommandPermission},new MistPrivateFiles(directory),auth.authorize);
});
afterEach(async()=>{vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});});
async function view(role:string=SYSTEM_ROLE_IDS.LOGISTICS){const{workspace,actor:current}=await repo.getForAgent(actorWith(role),workspaceId);return{state:workspace.state,actor:current};}
it('lets a finance reader see receipts, allocations, treasury, credits and requests, with bank account numbers masked',async()=>{
 const f=await view(SYSTEM_ROLE_IDS.SUPER_ADMIN);const types=agentCatalog(f.actor).map(t=>t.type);
 expect(types).toEqual(expect.arrayContaining(['receipt_record','receipt_allocation','bank_account','fx_record','letter_of_credit','rfq','sample_request','report_schedule','customer_statement','finance_reversal']));
 expect(agentGet(f.state,f.actor,'receipt_record','r1').data).toMatchObject({amount:1200,currency:'USD'});
 expect(agentGet(f.state,f.actor,'receipt_allocation','a1').link).toContain('id=r1');
 const bank=agentGet(f.state,f.actor,'bank_account','b1');expect(bank.data).toMatchObject({name:'USD main',accountNo:'****5678'});expect(JSON.stringify(bank)).not.toContain('6222');
 for(const [type,id] of [['fx_record','fx1'],['letter_of_credit','lc1'],['rfq','rfq1'],['sample_request','sr1'],['report_schedule','rs1']])expect(agentGet(f.state,f.actor,type,id).data).toMatchObject({id});
 expect(()=>agentGet(f.state,f.actor,'report_schedule','rs2')).toThrow();
});
it('hides bank accounts and treasury from an account without the matching finance permissions',async()=>{
 auth.users.get('clerk')!.permissions=['ai:chat','invoices:read','customs:read'];const f=await view(SYSTEM_ROLE_IDS.SALES);
 const types=agentCatalog(f.actor).map(t=>t.type);expect(types).not.toContain('bank_account');expect(types).not.toContain('fx_record');
 expect(()=>agentGet(f.state,f.actor,'bank_account','b1')).toThrow();expect(()=>agentGet(f.state,f.actor,'fx_record','fx1')).toThrow();
});
it('reads rebate rates and claims, masking tax-base amounts unless the account also holds sensitive:tax_base',async()=>{
 let f=await view(SYSTEM_ROLE_IDS.SUPER_ADMIN);
 expect(agentGet(f.state,f.actor,'rebate_rate','rt1').data).toMatchObject({hsCode:'6203',rate:'0.13'});
 const masked=agentGet(f.state,f.actor,'rebate_claim','cl1');expect(masked.data).toMatchObject({code:'RB-1',taxable:0,expected:0,taxMasked:true});expect(JSON.stringify(masked)).not.toContain('6400');
 auth.users.get('clerk')!.permissions=[...auth.users.get('clerk')!.permissions,'sensitive:tax_base'];f=await view(SYSTEM_ROLE_IDS.SUPER_ADMIN);
 expect(agentGet(f.state,f.actor,'rebate_claim','cl1').data).toMatchObject({taxable:50000,expected:6500});
 auth.users.get('clerk')!.permissions=['ai:chat'];f=await view(SYSTEM_ROLE_IDS.SALES);
 expect(agentCatalog(f.actor).map(t=>t.type)).not.toContain('rebate_claim');expect(()=>agentGet(f.state,f.actor,'rebate_claim','cl1')).toThrow();
});
it('reads month-end closes by month with closed or reopened status, and hides them without invoice read',async()=>{
 let f=await view(SYSTEM_ROLE_IDS.SUPER_ADMIN);
 expect(agentCatalog(f.actor).map(t=>t.type)).toContain('period_close');
 expect(agentGet(f.state,f.actor,'period_close','2026-09').data).toMatchObject({month:'2026-09',status:'closed'});
 expect(agentGet(f.state,f.actor,'period_close','2026-10').data).toMatchObject({status:'reopened',reopened:{reason:'fix'}});
 auth.users.get('clerk')!.permissions=['ai:chat'];f=await view(SYSTEM_ROLE_IDS.SALES);
 expect(agentCatalog(f.actor).map(t=>t.type)).not.toContain('period_close');expect(()=>agentGet(f.state,f.actor,'period_close','2026-09')).toThrow();
});
