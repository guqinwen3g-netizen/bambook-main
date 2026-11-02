import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createMistState,applyMistCommand,mistCommandPermission} from '../shared/mistWorkspace';
import {agentCommandRisk,AGENT_COMMAND_RISK,HIGH_RISK_COMMANDS,HIGH_RISK_PREFIXES,HIGH_RISK_VERB,type AgentCommandRisk} from '../shared/mistAgentProposals';
import {MemoryMistDatabase,testAuthority} from './__tests__/support';
import {MIST_COMMAND_CATALOG} from './agentCommandCatalog';
import {MistRepository} from './repository';import {createLoginRateLimiter} from '../auth/loginRateLimiter';import {MistPrivateFiles} from './files';
/** AI 写入三级确认：确认人须有该风险档的 ai:write:* 码；高风险须复验登录密码；原命令业务权限照常校验；等级按规则判定（见 mistAgentProposals.ts）。 */
let directory:string,db:MemoryMistDatabase,repo:MistRepository,auth:ReturnType<typeof testAuthority>,workspaceId:string,checked:string[];
// 本人自己的空间：没有公司行级范围，只看权限码。
const actor:any={userId:'staff',displayName:'Staff',roles:[],authorizationLoaded:true};
const PASSWORD='Correct-horse-1';
const LOW={type:'calendar.save',payload:{title:'回访客户',date:'2026-11-05',time:'10:00',note:''}};
const HIGH={type:'finance.account.save',payload:{name:'美元账户',bankName:'测试银行',accountNo:'ACC-001',currency:'USD',openingDate:'2026-11-01',openingBalance:0}};
function propose(command:any){db.workspaces.get(workspaceId).state.agentProposals=[{id:'proposal',ownerId:'staff',owner:'Staff',command,summary:['Agent 提议'],createdAt:'2026-11-01T00:00:00Z',state:'pending'}];}
const confirm=(reauth?:{password:string})=>repo.execute(actor,workspaceId,{requestId:randomUUID(),expectedRevision:0,command:{type:'agent.proposal.confirm',payload:{id:'proposal'}} as any,...(reauth?{reauth}:{})});
const proposalState=()=>db.workspaces.get(workspaceId).state.agentProposals[0].state;
beforeEach(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'mist-proposal-risk-'));db=new MemoryMistDatabase();auth=testAuthority();checked=[];
 auth.users.set('staff',{active:true,permissions:['ai:chat','vouchers:read','vouchers:write','ai:write:low','ai:write:medium','ai:write:high']});
 const state=createMistState({id:randomUUID,now:'2026-11-01T00:00:00Z',actorId:'staff',actorName:'Staff'},'empty');
 workspaceId=randomUUID();db.workspaces.set(workspaceId,{id:workspaceId,ownerId:'staff',companyId:null,slug:'own',name:'Own',revision:0,state,createdAt:new Date(),updatedAt:new Date()});
 repo=new MistRepository(db,{createMistState,applyMistCommand,mistCommandPermission},new MistPrivateFiles(directory),auth.authorize,undefined,undefined,undefined,async(_db,userId,password)=>{checked.push(userId);return userId==='staff'&&password===PASSWORD;});
});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});

describe('AI 提议三级确认',()=>{
 it('风险登记：低 / 中 / 高三档，未登记命令一律按高处理，登记表里没有不存在的命令',()=>{
  expect(agentCommandRisk('crm.followUp.save')).toBe('low');expect(agentCommandRisk('email.move')).toBe('medium');expect(agentCommandRisk('market.quotation.save')).toBe('medium');
  for(const type of ['payable.payment.register','payable.request.decide','finance.reconcile','fulfillment.documents.void','order.governance.decide','platform.credit.issue'])expect([type,agentCommandRisk(type)]).toEqual([type,'high']);
  // 按用户 2026-11-02 定案改为规则判定：未登记的普通写入为中风险，不再一律按高。
  expect(agentCommandRisk('brand.new.command')).toBe('medium');expect(agentCommandRisk('unregistered.command')).toBe('medium');
  expect(agentCommandRisk('brand.new.approve')).toBe('high');expect(agentCommandRisk('payable.anything')).toBe('high');
  const known=new Set(MIST_COMMAND_CATALOG.map(c=>c.type));for(const type of Object.keys(AGENT_COMMAND_RISK))expect([type,known.has(type)]).toEqual([type,true]);
 });
 it('守卫：命令目录逐条按规则分级，资金 / 审批 / 核销命令一律为高',()=>{
  // 显式登记优先于规则；登记里与规则冲突的只有下面两条中风险例外（原因见 mistAgentProposals.ts）。
  const exceptions:Record<string,AgentCommandRisk>={'payable.settlement.submit':'medium','order.fabric.allocate':'medium'};
  const rule=(type:string):AgentCommandRisk=>HIGH_RISK_COMMANDS.has(type)||HIGH_RISK_PREFIXES.some(p=>type.startsWith(p))||HIGH_RISK_VERB.test(type)?'high':'medium';
  for(const {type} of MIST_COMMAND_CATALOG){
   const registered=AGENT_COMMAND_RISK[type];
   if(registered&&registered!==rule(type)&&registered!=='low')expect([type,registered]).toEqual([type,exceptions[type]]);
   expect([type,agentCommandRisk(type)]).toEqual([type,exceptions[type]??registered??rule(type)]);
  }
  for(const [type,risk] of Object.entries(exceptions))expect([type,agentCommandRisk(type)]).toEqual([type,risk]);
  const money=['payable.payment.register','payable.request.decide','payable.bill.register','payable.prepayment.refund','finance.receivable.confirm','finance.reconcile','finance.payment.save','funding.release','fxrate.period.save','lc.present','rebate.claim.approve','opening.payable.import','platform.credit.issue','platform.invoice.issue','platform.claim.recovery.waive','platform.claim.recovery.settle','market.supplier.bank.save','cost.expense.payable','development.billing.issue','market.marginFloor.set'];
  const approval=['order.governance.decide','market.quotation.decide','platform.claim.decide','platform.risk.decide','development.qc.decide','fulfillment.procurement.decide','fulfillment.production.intake.decide','fulfillment.production.release','fulfillment.documents.void','order.governance.void','cost.expense.void','payable.settlement.reverse','finance.payment.reverse','order.internal.reverseCheck'];
  const authority=['settings.update','member.groups.set','teamScope.save','handover.customer','handover.account','platform.employee.save','platform.pricingParams.set'];
  const known=new Set(MIST_COMMAND_CATALOG.map(c=>c.type));
  for(const type of [...money,...approval,...authority]){expect([type,known.has(type)]).toEqual([type,true]);expect([type,agentCommandRisk(type)]).toEqual([type,'high']);}
  for(const type of ['order.create','market.quotation.convert','market.quotation.submit','development.submit','fulfillment.procurement.submit','fulfillment.shipments.depart','platform.claim.create','contact.delete','rfq.award'])expect([type,agentCommandRisk(type)]).toEqual([type,'medium']);
 });
 it('缺少该风险档的 ai:write 码时拒绝确认，提议保持待确认',async()=>{
  propose(LOW);auth.users.get('staff')!.permissions=['ai:chat','ai:write:medium','ai:write:high'];
  await expect(confirm()).rejects.toMatchObject({code:'FORBIDDEN',status:403,message:expect.stringContaining('ai:write:low')});
  expect(proposalState()).toBe('pending');
  auth.users.get('staff')!.permissions.push('ai:write:low');await confirm();expect(proposalState()).toBe('confirmed');
 });
 it('低风险不要求密码复验',async()=>{propose(LOW);await confirm();expect(checked).toEqual([]);expect(proposalState()).toBe('confirmed');});
 it('高风险缺密码或密码错误时拒绝，业务不变；本人正确密码后才执行',async()=>{
  propose(HIGH);
  await expect(confirm()).rejects.toMatchObject({code:'REAUTH_REQUIRED',status:403});
  await expect(confirm({password:'wrong-password'})).rejects.toMatchObject({code:'REAUTH_FAILED',status:403});
  expect(checked).toEqual(['staff']);expect(proposalState()).toBe('pending');expect(db.workspaces.get(workspaceId).state.bankAccounts??[]).toHaveLength(0);
  await confirm({password:PASSWORD});
  expect(proposalState()).toBe('confirmed');expect(db.workspaces.get(workspaceId).state.bankAccounts.some((a:any)=>a.accountNo==='ACC-001')).toBe(true);
  expect(JSON.stringify([...db.receipts.values()])).not.toContain(PASSWORD);
 });
 it('高风险缺 ai:write:high 时即使密码正确也拒绝',async()=>{
  propose(HIGH);auth.users.get('staff')!.permissions=auth.users.get('staff')!.permissions.filter(p=>p!=='ai:write:high');
  await expect(confirm({password:PASSWORD})).rejects.toMatchObject({code:'FORBIDDEN',message:expect.stringContaining('ai:write:high')});expect(proposalState()).toBe('pending');
 });
 it('确认人缺少原命令的业务权限时拒绝，不能借 AI 越权',async()=>{
  // 失去原命令的写权限：提议对本人显示为不可用，确认被拒；密码正确、AI 三档齐全也不行。
  propose(HIGH);auth.users.get('staff')!.permissions=auth.users.get('staff')!.permissions.filter(p=>p!=='vouchers:write');
  await expect(confirm({password:PASSWORD})).rejects.toMatchObject({status:expect.any(Number)});
  expect(proposalState()).toBe('pending');expect(db.workspaces.get(workspaceId).revision).toBe(0);
  // 原业务命令门禁（own(permission)）在 AI 档位与密码之前执行：缺业务权限时 403 或提议不可用 409，均不执行。
  propose(LOW);auth.users.get('staff')!.permissions=['ai:chat','ai:write:low'];
  const strict=new MistRepository(db,{createMistState,applyMistCommand,mistCommandPermission:(c:any)=>c.type==='calendar.save'?'orders:write':mistCommandPermission(c)},new MistPrivateFiles(directory),auth.authorize);
  const error:any=await strict.execute(actor,workspaceId,{requestId:randomUUID(),expectedRevision:0,command:{type:'agent.proposal.confirm',payload:{id:'proposal'}} as any}).catch(e=>e);
  expect([403,409]).toContain(error.status);expect(proposalState()).toBe('pending');expect(db.workspaces.get(workspaceId).revision).toBe(0);
 });
 it('未显式登记的资金命令按规则为高：没有密码不执行',async()=>{
  expect(AGENT_COMMAND_RISK['finance.account.save']).toBeUndefined();
  propose(HIGH);await expect(confirm()).rejects.toMatchObject({code:'REAUTH_REQUIRED'});
 });
 it('密码复验只用于确认提议：普通命令附带 reauth 不会被当作授权',async()=>{
  propose(HIGH);auth.users.get('staff')!.permissions=['ai:chat','vouchers:read','vouchers:write'];
  await expect(confirm({password:PASSWORD})).rejects.toMatchObject({code:'FORBIDDEN'});
 });

 describe('高风险密码复验限流与加锁顺序',()=>{
  let clock:number,order:string[],limited:MistRepository;
  beforeEach(()=>{
   clock=Date.parse('2026-11-02T08:00:00Z');order=[];
   // 包一层事务：记录工作区行锁（FOR UPDATE）的时刻，与密码比对的时刻对照。
   const wrapped:any=Object.create(db);wrapped.$transaction=(run:any)=>db.$transaction((tx:any)=>run({...tx,$queryRawUnsafe:async(sql:string)=>{if(/FOR UPDATE/.test(sql))order.push('lock');return [];}}));
   limited=new MistRepository(wrapped,{createMistState,applyMistCommand,mistCommandPermission},new MistPrivateFiles(directory),auth.authorize,undefined,undefined,undefined,async(_db,userId,password)=>{checked.push(userId);order.push('verify');return userId==='staff'&&password===PASSWORD;},createLoginRateLimiter({now:()=>clock}));
  });
  const confirmLimited=(reauth?:{password:string})=>limited.execute(actor,workspaceId,{requestId:randomUUID(),expectedRevision:db.workspaces.get(workspaceId).revision,command:{type:'agent.proposal.confirm',payload:{id:'proposal'}} as any,...(reauth?{reauth}:{})});
  it('15 分钟内 5 次错误后锁定：第 6 次不比对密码直接拒绝，窗口过后可再试',async()=>{
   propose(HIGH);
   for(let i=0;i<5;i++)await expect(confirmLimited({password:'wrong-'+i})).rejects.toMatchObject({code:'REAUTH_FAILED',status:403});
   expect(checked).toHaveLength(5);
   await expect(confirmLimited({password:PASSWORD})).rejects.toMatchObject({code:'REAUTH_LOCKED',status:429,message:expect.stringContaining('分钟后再试')});
   expect(checked).toHaveLength(5);expect(proposalState()).toBe('pending');
   clock+=15*60*1000+1;
   await confirmLimited({password:PASSWORD});expect(checked).toHaveLength(6);expect(proposalState()).toBe('confirmed');
  });
  it('成功复验清零失败计数',async()=>{
   propose(HIGH);
   for(let i=0;i<4;i++)await expect(confirmLimited({password:'wrong-'+i})).rejects.toMatchObject({code:'REAUTH_FAILED'});
   await confirmLimited({password:PASSWORD});expect(proposalState()).toBe('confirmed');
   propose(HIGH);db.workspaces.get(workspaceId).state.bankAccounts=[];
   for(let i=0;i<4;i++)await expect(confirmLimited({password:'again-'+i})).rejects.toMatchObject({code:'REAUTH_FAILED'});
   const before=checked.length;await confirmLimited({password:PASSWORD});expect(checked.length).toBe(before+1);expect(proposalState()).toBe('confirmed');
  });
  it('密码比对发生在取工作区行锁之前，失败时不取锁',async()=>{
   propose(HIGH);
   await expect(confirmLimited({password:'wrong'})).rejects.toMatchObject({code:'REAUTH_FAILED'});expect(order).toEqual(['verify']);
   order.length=0;await confirmLimited({password:PASSWORD});
   expect(order[0]).toBe('verify');expect(order).toContain('lock');expect(order.indexOf('verify')).toBeLessThan(order.indexOf('lock'));expect(order.filter(x=>x==='verify')).toHaveLength(1);
  });
  it('锁外复验的是低风险提议、锁内已换成高风险命令时拒绝执行',async()=>{
   propose(LOW);
   // 锁外读到低风险（不复验），进入锁前提议被换成高风险命令：锁内按最新状态判为高，没有同一提议的复验凭证即拒绝。
   const original=(limited as any).executeInternal.bind(limited);
   (limited as any).executeInternal=(...args:any[])=>{db.workspaces.get(workspaceId).state.agentProposals[0].command=HIGH;args[2]={...args[2],command:HIGH};return original(...args);};
   await expect(confirmLimited({password:PASSWORD})).rejects.toMatchObject({code:'REAUTH_REQUIRED'});
   expect(checked).toEqual([]);expect(proposalState()).toBe('pending');expect(db.workspaces.get(workspaceId).state.bankAccounts??[]).toHaveLength(0);
  });
  it('复验凭证只对同一提议的同一份命令有效',async()=>{
   propose(HIGH);
   const original=(limited as any).executeInternal.bind(limited);
   (limited as any).executeInternal=(...args:any[])=>{const changed={...HIGH,payload:{...HIGH.payload,accountNo:'ACC-999'}};db.workspaces.get(workspaceId).state.agentProposals[0].command=changed;args[2]={...args[2],command:changed};return original(...args);};
   await expect(confirmLimited({password:PASSWORD})).rejects.toMatchObject({code:'REAUTH_REQUIRED'});
   expect(proposalState()).toBe('pending');expect(db.workspaces.get(workspaceId).state.bankAccounts??[]).toHaveLength(0);
  });
 });
});
