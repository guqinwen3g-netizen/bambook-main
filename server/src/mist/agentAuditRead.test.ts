import { describe, expect, it } from 'vitest';
import { createMistState, mistCommandPermission, type MistState } from '../shared/mistWorkspace';
import { projectState } from './access';
import { createAgentCommandAudit } from './agentAudit';
import { projectAgentAudit } from './agentAuditRead';
const actor=(permissions:string[],id='finance'):any=>({userId:id,displayName:id,roles:[],permissions,authorizationLoaded:true});
const empty=()=>createMistState({id:()=> 'id',now:'2026-10-31T08:00:00Z',actorId:'finance',actorName:'Finance'},'empty');
function audit(before:any,after:any,command:any,owner='finance') {return createAgentCommandAudit({workspaceId:'workspace',requestId:'operation',at:'2026-10-31T08:00:00Z',actor:{id:owner,name:owner},source:'agent',agentSessionId:'session',phase:'executed',command,requestedRevision:0,baseRevision:0,committedRevision:1,before,after});}
function view(a:any,current:MistState,user:any,scope?:any,projectOverride?:(s:MistState)=>MistState){const project=projectOverride??((s:MistState)=>projectState(s,user,empty,undefined,scope).state);return projectAgentAudit(a,{actor:user,current,visible:project(current),project,permission:c=>mistCommandPermission(c),unrestricted:!scope,offset:0,limit:50,includeCommand:true});}

describe('Audit deltas use current section, field and row visibility',()=>{
  it('lets another authorized actor inspect proved settlement input while omitting ignored request fields',()=>{
    const before=empty();before.fulfillment.purchases=[{id:'purchase',code:'PO-1'} as any];
    const after=structuredClone(before);after.payables.settlements=[{id:'settlement',purchaseId:'purchase',receiptIds:[],state:'pending',note:'实收已核对',amount:110670} as any];
    const command={type:'payable.settlement.submit',payload:{purchaseId:'purchase',receiptIds:[],note:'实收已核对',ignored:'private request scratchpad'}};
    const result=view(audit(before,after,command,'buyer'),after,actor(['procurement:read','invoices:read','vouchers:read','audit:read']));
    expect(result.commandAvailable).toBe(true);expect(result.commandRestricted).toBe(true);
    expect(result.command.payload).toEqual({purchaseId:'purchase',receiptIds:[],note:'实收已核对'});
    expect(JSON.stringify(result)).not.toContain('private request scratchpad');
  });

  it('never uses historical ownership as proof of unchanged input on a currently hidden primary record',()=>{
    const before=empty();before.orders=[{id:'order',type:'garment',ownerId:'sales',customerId:'customer',note:'private historical input'} as any];before.customers=[{id:'customer',ownerId:'other'} as any];
    const after=structuredClone(before);after.orders[0].ownerId='other';
    const command={type:'order.update',payload:{orderId:'order',patch:{note:'private historical input'}}};
    const result=view(audit(before,after,command,'sales'),after,actor(['orders:read'],'sales'),{userIds:['sales'],teamIds:[]});
    expect(result.commandAvailable).toBe(false);expect(JSON.stringify(result)).not.toContain('private historical input');
  });

  it('allows only already-visible lines of mixed bills, without exposing whole-bill totals',()=>{
    const before=empty();before.orders=[{id:'mine',type:'fabric',ownerId:'sales'},{id:'theirs',type:'fabric',ownerId:'other'}] as any;
    before.fulfillment.purchases=[{id:'p1',code:'PO-1',orderId:'mine'},{id:'p2',code:'PO-2',orderId:'theirs'}] as any;
    before.payables.bills=[{id:'bill',code:'BILL-1',supplier:'供方',currency:'CNY',amount:100,lines:[{purchaseId:'p1',purchaseCode:'PO-1',kind:'material',amount:40},{purchaseId:'p2',purchaseCode:'PO-2',kind:'material',amount:60}],state:'active'}] as any;
    const after=structuredClone(before);after.payables.bills[0].lines[0].amount=45;after.payables.bills[0].amount=105;
    const user=actor(['orders:read','procurement:read','invoices:read','vouchers:read'],'sales'),scope={userIds:['sales'],teamIds:[]};
    expect(projectState(after,user,empty,undefined,scope).state.partialPayableBills).toHaveLength(1);
    const result=view(audit(before,after,{type:'payable.bill.link',payload:{id:'bill'}},'other'),after,user,scope);
    expect(JSON.stringify(result.changes)).toContain('PO-1');expect(JSON.stringify(result.changes)).toContain('45');
    expect(JSON.stringify(result.changes)).not.toContain('PO-2');expect(JSON.stringify(result.changes)).not.toContain('105');expect(result.detailsRestricted).toBe(true);
    expect(result.targets.some(target=>target.id==='bill')).toBe(false);
  });
  it('shows actual finance changes and the owner command, but hides both when voucher access is revoked',()=>{
    const before=empty();before.payables.settlements=[{id:'settlement',state:'pending',amount:110670,note:'supplier-private'} as any];
    const after=structuredClone(before);after.payables.settlements[0].state='confirmed';
    const command={type:'payable.settlement.confirm',payload:{id:'settlement',note:'supplier-private'}};
    const a=audit(before,after,command),allowed=view(a,after,actor(['invoices:read','vouchers:read','audit:read']));
    expect(allowed.changes).toContainEqual(expect.objectContaining({before:'pending',after:'confirmed'}));
    expect(allowed.command.payload).toEqual(command.payload);
    const denied=view(a,after,actor(['invoices:read','audit:read']));
    expect(denied.changes).toEqual([]);expect(denied.commandRestricted).toBe(true);
    expect(JSON.stringify(denied)).not.toContain('supplier-private');
  });

  it('does not restore live records moved out of the reader scope by overlaying their historical ownership',()=>{
    const before=empty();before.orders=[{id:'order',type:'garment',ownerId:'sales',customerId:'customer',note:'old commercial note'} as any];before.customers=[{id:'customer',ownerId:'other'} as any];
    const after=structuredClone(before);(after.orders[0] as any).note='private commercial note';
    const a=audit(before,after,{type:'order.update',payload:{id:'order',patch:{note:'private commercial note'}}},'sales');
    const current=structuredClone(after);current.orders[0].ownerId='other';
    const denied=view(a,current,actor(['orders:read'],'sales'),{userIds:['sales'],teamIds:[]});
    expect(denied.changes).toEqual([]);expect(denied.detailsRestricted).toBe(true);expect(denied.commandRestricted).toBe(true);
    expect(JSON.stringify(denied)).not.toContain('commercial note');
  });

  it('a private proposal mentioning a hidden id does not establish visibility of that business record',()=>{
    const current=empty();current.orders=[{id:'order',type:'garment',ownerId:'other',customerId:'customer'} as any];current.customers=[{id:'customer',ownerId:'other'} as any];
    const command={type:'order.update',payload:{id:'order',patch:{note:'hidden proposal content'}}};
    current.agentProposals=[{id:'proposal',ownerId:'sales',owner:'Sales',command,summary:['old proposal'],createdAt:'2026-10-31',state:'pending'}];
    const before=structuredClone(current);before.agentProposals=[];
    const a=audit(before,current,{type:'agent.proposal.create',payload:{command,summary:['old proposal']}},'sales');
    const denied=view(a,current,actor(['orders:read'],'sales'),{userIds:['sales'],teamIds:[]});
    expect(denied.commandRestricted).toBe(true);expect(JSON.stringify(denied)).not.toContain('hidden proposal content');
  });

  it('a visible record with the same id in another collection cannot authorize hidden proposal input',()=>{
    const current=empty();current.orders=[{id:'same-id',type:'garment',ownerId:'other',customerId:'customer'} as any];current.customers=[{id:'customer',ownerId:'other'},{id:'same-id',name:'Visible customer',ownerId:'sales'} as any];
    const command={type:'order.update',payload:{orderId:'same-id',patch:{note:'hidden order input'}}};
    const before=structuredClone(current);current.agentProposals=[{id:'proposal',ownerId:'sales',owner:'Sales',command,summary:['proposal'],createdAt:'2026-10-31',state:'pending'}];
    const a=audit(before,current,{type:'agent.proposal.create',payload:{command,summary:['proposal']}},'sales');
    const denied=view(a,current,actor(['orders:read','relations:read'],'sales'),{userIds:['sales'],teamIds:[]});
    expect(denied.commandRestricted).toBe(true);expect(JSON.stringify(denied)).not.toContain('hidden order input');
  });

  it('requires audit authority for deleted records, and applies field rules even to auditors',()=>{
    const before=empty();before.bankAccounts=[{id:'bank',accountNo:'private-account',name:'Bank'} as any];
    const after=structuredClone(before);after.bankAccounts=[];
    const a=audit(before,after,{type:'finance.account.close',payload:{id:'bank'}});
    expect(view(a,after,actor(['vouchers:write'])).changes).toEqual([]);
    const denied=view(a,after,actor(['vouchers:read','audit:read']));expect(denied.changes).toEqual([]);expect(JSON.stringify(denied)).not.toContain('private-account');
    const allowed=view(a,after,actor(['vouchers:write','audit:read']));expect(allowed.changes.some(c=>JSON.stringify(c.before).includes('private-account'))).toBe(true);
  });

  it('does not present a newly derived partial total as the original historical amount',()=>{
    const before=empty();before.payables.bills=[{id:'bill',amount:100} as any];const after=structuredClone(before);after.payables.bills[0].amount=200;
    const a=audit(before,after,{type:'payable.bill.register',payload:{amount:200}});
    const project=(s:MistState)=>{const result=structuredClone(s);result.payables.bills[0].amount=50;return result;};
    const result=view(a,after,actor(['invoices:read','vouchers:read']),undefined,project);
    expect(result.changes).toEqual([]);expect(result.detailsRestricted).toBe(true);expect(JSON.stringify(result)).not.toContain('"after":50');
  });
  it('source links cannot reveal a supplier relationship from a restricted financial command',()=>{
    const before=empty();before.market.suppliers=[{id:'supplier',name:'Hidden audit association'} as any];before.payables.bills=[{id:'bill',supplierId:'supplier',amount:100} as any];
    const after=structuredClone(before);after.payables.bills[0].amount=200;
    const a=audit(before,after,{type:'payable.bill.register',payload:{id:'bill',supplierId:'supplier',amount:200}});
    const result=view(a,after,actor(['suppliers:read','audit:read'],'auditor'));
    expect(result.targets).toEqual([]);expect(JSON.stringify(result)).not.toContain('Hidden audit association');
  });
});
