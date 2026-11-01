import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createMistState,applyMistCommand,mistCommandPermission} from '../shared/mistWorkspace';
import {SYSTEM_ROLE_IDS,getDefaultScopeListForRole} from '../_shared/rolePermissionMatrix';
import {MemoryMistDatabase,testAuthority} from './__tests__/support';
import {MIST_COMMAND_CATALOG} from './agentCommandCatalog';
import {MistRepository} from './repository';import {MistPrivateFiles} from './files';
let directory:string,db:MemoryMistDatabase,repo:MistRepository,auth:ReturnType<typeof testAuthority>,workspaceId:string;
const company='11111111-1111-4111-8111-111111111111';
const actor:any={userId:'sales',displayName:'Sales',roleIds:[SYSTEM_ROLE_IDS.SALES+'@'+company],roles:[],companyId:company,authorizationLoaded:true};
beforeEach(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'mist-proposal-privacy-'));db=new MemoryMistDatabase();auth=testAuthority();auth.users.set('sales',{active:true,permissions:getDefaultScopeListForRole(SYSTEM_ROLE_IDS.SALES)});db.companyMembers.push({companyId:company,userId:'sales',status:'active'});
 const state=createMistState({id:randomUUID,now:'2026-11-01T00:00:00Z',actorId:'sales',actorName:'Sales'},'empty');
 state.customers=[{id:'customer',ownerId:'other',name:'Hidden customer'} as any];state.orders=[{id:'order',type:'garment',ownerId:'other',customerId:'customer',code:'PRIVATE-ORDER',lines:0,qty:0,amount:0} as any];
 state.agentProposals=[{id:'proposal',ownerId:'sales',owner:'Sales',command:{type:'order.governance.decide',payload:{id:'order',decision:'approved',note:'private decision sentinel'}},summary:['PRIVATE-ORDER private summary sentinel'],createdAt:'2026-11-01T00:00:00Z',state:'pending'}];
 workspaceId=randomUUID();db.workspaces.set(workspaceId,{id:workspaceId,ownerId:'other',companyId:company,slug:'company@'+company,name:'Company',revision:0,state,createdAt:new Date(),updatedAt:new Date()});repo=new MistRepository(db,{createMistState,applyMistCommand,mistCommandPermission},new MistPrivateFiles(directory),auth.authorize);
});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
it('hides a non-task proposal whose original order is outside the owner’s current row scope',async()=>{
 const result=await repo.get(actor,workspaceId);expect(result.state.orders).toEqual([]);expect(result.state.agentProposals?.[0].unavailable).toBe(true);expect(JSON.stringify(result)).not.toContain('private decision sentinel');expect(JSON.stringify(result)).not.toContain('private summary sentinel');
});
it('does not let a visible record with the same id authorize a hidden proposal source',async()=>{
 const row=db.workspaces.get(workspaceId);row.state.customers.push({id:'order',ownerId:'sales',name:'Visible customer'});
 const result=await repo.get(actor,workspaceId);expect(result.state.customers.some(c=>c.id==='order')).toBe(true);expect(JSON.stringify(result.state.agentProposals)).not.toContain('private decision sentinel');
});
it('retains currently visible proposal details, then masks them after module read access is removed',async()=>{
 db.workspaces.get(workspaceId).state.orders[0].ownerId='sales';
 expect(JSON.stringify((await repo.get(actor,workspaceId)).state.agentProposals)).toContain('private decision sentinel');
 auth.users.get('sales')!.permissions=['ai:chat'];const result=await repo.get(actor,workspaceId);expect(result.state.agentProposals?.[0].unavailable).toBe(true);expect(JSON.stringify(result.state.agentProposals)).not.toContain('private summary sentinel');
});
it('refuses direct confirmation without current read access but still permits safe rejection',async()=>{
 const row=db.workspaces.get(workspaceId);row.state.orders[0].ownerId='sales';auth.users.get('sales')!.permissions=['ai:chat','orders:write'];const before=JSON.stringify(row.state.orders);
 await expect(repo.execute(actor,workspaceId,{requestId:randomUUID(),expectedRevision:0,command:{type:'agent.proposal.confirm',payload:{id:'proposal'}}})).rejects.toMatchObject({code:'AGENT_PROPOSAL_UNAVAILABLE',status:409});
 await repo.execute(actor,workspaceId,{requestId:randomUUID(),expectedRevision:0,command:{type:'agent.proposal.reject',payload:{id:'proposal',note:'Current source is unavailable'}}});
 expect(db.workspaces.get(workspaceId).state.agentProposals[0].state).toBe('rejected');expect(JSON.stringify(db.workspaces.get(workspaceId).state.orders)).toBe(before);
});
it('allows authorized proposals for a new record without requiring its not-yet-created ID to exist',async()=>{
 const row=db.workspaces.get(workspaceId);row.state.agentProposals[0].command={type:'email.account.save',payload:{id:'new-account',name:'New mailbox',address:'person@example.test'}};row.state.agentProposals[0].summary=['New mailbox'];auth.users.get('sales')!.permissions=['ai:chat','emails:read','emails:write'];
 const proposal=(await repo.get(actor,workspaceId)).state.agentProposals![0];expect(proposal.unavailable).not.toBe(true);expect(proposal.command.payload.id).toBe('new-account');
});

it('rechecks source visibility inside the committing transaction after an earlier readable confirmation lookup',async()=>{
 db.workspaces.get(workspaceId).state.orders[0].ownerId='sales';
 const authorize:typeof auth.authorize=async(db,prior,permission)=>{if(permission==='orders:write')auth.users.get('sales')!.permissions=['ai:chat','orders:write'];return auth.authorize(db,prior,permission);};
 repo=new MistRepository(db,{createMistState,applyMistCommand,mistCommandPermission},new MistPrivateFiles(directory),authorize);
 await expect(repo.execute(actor,workspaceId,{requestId:randomUUID(),expectedRevision:0,command:{type:'agent.proposal.confirm',payload:{id:'proposal'}}})).rejects.toMatchObject({code:'FORBIDDEN',status:403});
 expect(db.workspaces.get(workspaceId).revision).toBe(0);expect(db.workspaces.get(workspaceId).state.agentProposals[0].state).toBe('pending');
});
it('keeps company bank details hidden from a row-scoped reader even when voucher write access remains',async()=>{
 const row=db.workspaces.get(workspaceId);row.state.bankAccounts=[{id:'bank',code:'BANK-SECRET',currency:'CNY'}];row.state.agentProposals[0].command={type:'finance.account.close',payload:{id:'bank',reason:'private bank sentinel'}};row.state.agentProposals[0].summary=['BANK-SECRET'];auth.users.get('sales')!.permissions=['ai:chat','vouchers:read','vouchers:write'];
 const result=await repo.get(actor,workspaceId);expect(result.state.bankAccounts).toEqual([]);expect(result.state.agentProposals![0].unavailable).toBe(true);expect(JSON.stringify(result.state.agentProposals)).not.toContain('private bank sentinel');
});
it('hides a supported draft-deletion proposal after mailbox sharing is withdrawn',async()=>{
 const row=db.workspaces.get(workspaceId);row.state.email.accounts=[{id:'mailbox',ownerId:'other',memberIds:[],address:'other@example.test',kind:'personal',example:false}];row.state.email.drafts=[{id:'draft',accountId:'mailbox',body:'private draft sentinel'}];row.state.agentProposals[0].command={type:'email.draft.delete',payload:{id:'draft'}};row.state.agentProposals[0].summary=['private draft sentinel'];expect(MIST_COMMAND_CATALOG.some(c=>c.type===row.state.agentProposals[0].command.type)).toBe(true);auth.users.get('sales')!.permissions=['ai:chat','emails:read','emails:write'];
 const result=await repo.get(actor,workspaceId);expect(result.state.email.drafts).toEqual([]);expect(result.state.agentProposals![0].unavailable).toBe(true);expect(JSON.stringify(result.state.agentProposals)).not.toContain('private draft sentinel');
});
it('keeps the current company administrator’s valid member grouping proposal available without inventing users:read',async()=>{
 const row=db.workspaces.get(workspaceId);row.ownerId='sales';row.state.agentProposals[0].command={type:'member.groups.set',payload:{userId:'sales',groups:['garment']}};row.state.agentProposals[0].summary=['Set business groups'];auth.users.get('sales')!.permissions=['ai:chat','users:write'];
 const result=await repo.get(actor,workspaceId);expect(result.state.agentProposals![0].unavailable).not.toBe(true);expect(result.state.agentProposals![0].command.type).toBe('member.groups.set');
});

it('does not treat being a company library creator as current member-management authority',async()=>{
 const row=db.workspaces.get(workspaceId);row.ownerId='sales';row.state.agentProposals[0].command={type:'member.groups.set',payload:{userId:'sales',groups:['garment']}};
 expect((await repo.get(actor,workspaceId)).state.agentProposals![0].unavailable).toBe(true);
});
