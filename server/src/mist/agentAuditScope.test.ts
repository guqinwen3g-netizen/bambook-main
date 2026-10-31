import {afterEach,beforeEach,describe,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createMistState,applyMistCommand,mistCommandPermission} from '../shared/mistWorkspace';
import {SYSTEM_ROLE_IDS,getDefaultScopeListForRole} from '../_shared/rolePermissionMatrix';
import {MemoryMistDatabase,testAuthority} from './__tests__/support';
import {MistRepository} from './repository';import {MistPrivateFiles} from './files';
import {createAgentCommandAudit,AGENT_AUDIT_FIELD,AGENT_AUDIT_HASH,agentAuditReceiptId} from './agentAudit';
const company='11111111-1111-4111-8111-111111111111';
let directory:string,db:MemoryMistDatabase,repo:MistRepository,auth:ReturnType<typeof testAuthority>,workspaceId:string;
const actor=(id:string,role:string):any=>({userId:id,displayName:id,roles:[],roleIds:[role+'@'+company],companyId:company,authorizationLoaded:true});
const sales=()=>actor('sales',SYSTEM_ROLE_IDS.SALES),finance=()=>actor('finance',SYSTEM_ROLE_IDS.FINANCE);
beforeEach(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'mist-audit-scope-'));db=new MemoryMistDatabase();auth=testAuthority();
  for(const [id,role] of [['sales',SYSTEM_ROLE_IDS.SALES],['finance',SYSTEM_ROLE_IDS.FINANCE],['other',SYSTEM_ROLE_IDS.SALES]]){auth.users.set(id,{active:true,permissions:getDefaultScopeListForRole(role as any)});db.companyMembers.push({companyId:company,userId:id,status:'active'});}
  const before=createMistState({id:randomUUID,now:'2026-10-31T08:00:00Z',actorId:'sales',actorName:'销售甲'},'empty');
  before.customers=[{id:'customer',ownerId:'other',name:'Customer'} as any];before.orders=[{id:'order',type:'garment',ownerId:'other',customerId:'customer',code:'ORDER-HIDDEN',note:'old hidden value'} as any];
  const state=structuredClone(before);(state.orders[0] as any).note='private-order-value';workspaceId=randomUUID();
  db.workspaces.set(workspaceId,{id:workspaceId,ownerId:'finance',companyId:company,slug:'company@'+company,name:'Company',revision:1,state,createdAt:new Date(),updatedAt:new Date()});
  const a=createAgentCommandAudit({workspaceId,requestId:'own-history',at:'2026-10-31T08:00:00Z',actor:{id:'sales',name:'销售甲'},source:'agent',agentSessionId:'session',phase:'executed',command:{type:'order.update',payload:{orderId:'order',patch:{note:'private-order-value'}}},requestedRevision:0,baseRevision:0,committedRevision:1,before,after:state});
  const parent={id:randomUUID(),workspaceId,requestId:'own-history',actorId:'sales',inputHash:'parent',expectedRevision:0,result:{revision:1,result:{}},createdAt:new Date('2026-10-31T08:00:00Z')};db.receipts.set(workspaceId+':own-history',parent);
  db.receipts.set(workspaceId+':'+agentAuditReceiptId('own-history'),{...parent,id:randomUUID(),requestId:agentAuditReceiptId('own-history'),inputHash:AGENT_AUDIT_HASH,result:{revision:1,[AGENT_AUDIT_FIELD]:a}});
  repo=new MistRepository(db,{createMistState,applyMistCommand,mistCommandPermission},new MistPrivateFiles(directory),auth.authorize);
});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
describe('Audit query reuses live company authority and business row projection',()=>{
  it('lets an employee find own metadata without reviving a currently hidden order',async()=>{
    expect((await repo.agentAudits(sales(),workspaceId)).items).toHaveLength(1);
    const detail=await repo.agentAudit(sales(),workspaceId,'own-history',{includeCommand:true});
    expect(detail.changes).toEqual([]);expect(detail.commandRestricted).toBe(true);expect(JSON.stringify(detail)).not.toContain('private-order-value');expect(JSON.stringify(detail)).not.toContain('ORDER-HIDDEN');
    await expect(repo.agentAudits(sales(),workspaceId,{scope:'company'})).rejects.toMatchObject({status:403});
  });
  it('company audit access does not replace the current business read permission',async()=>{
    const allowed=await repo.agentAudit(finance(),workspaceId,'own-history');expect(JSON.stringify(allowed.changes)).toContain('private-order-value');
    auth.users.get('finance')!.permissions=['audit:read'];
    expect((await repo.agentAudits(finance(),workspaceId,{scope:'company'})).items).toHaveLength(1);
    const restricted=await repo.agentAudit(finance(),workspaceId,'own-history',{includeCommand:true});expect(restricted.changes).toEqual([]);expect(JSON.stringify(restricted)).not.toContain('private-order-value');
    auth.users.get('finance')!.permissions=[];
    await expect(repo.agentAudits(finance(),workspaceId,{scope:'company'})).rejects.toMatchObject({status:403});
  });
  it('refuses company mismatches and disabled accounts on each new read',async()=>{
    await expect(repo.agentAudits({...sales(),companyId:randomUUID()},workspaceId)).rejects.toMatchObject({status:404});
    auth.users.get('sales')!.active=false;await expect(repo.agentAudit(sales(),workspaceId,'own-history')).rejects.toMatchObject({status:401});
  });
  it('reports unavailable history instead of inventing an entry without its committed business receipt',async()=>{
    db.receipts.delete(workspaceId+':own-history');
    const page=await repo.agentAudits(sales(),workspaceId);expect(page.items).toEqual([]);expect(page.unavailableCount).toBe(1);
    await expect(repo.agentAudit(sales(),workspaceId,'own-history')).rejects.toMatchObject({status:404});
  });
});
