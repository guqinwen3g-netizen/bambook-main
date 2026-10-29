import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({resolve:vi.fn(),dept:vi.fn(),claim:vi.fn(),users:new Map<string,any>(),build:vi.fn()}));
vi.mock('../approvals/approvalRoutingService',()=>({createApprovalRoutingService:()=>({resolveReviewerByDepartment:mocks.dept,resolveClaimLeader:mocks.claim})}));
vi.mock('../orders/orderMainApprovalService',()=>({createOrderMainApprovalService:()=>({resolveEligibleReviewerIds:mocks.resolve})}));
vi.mock('../auth/tokenHelpers',()=>({loadUserWithRoles:async(_db:any,id:string)=>mocks.users.get(id)||null,buildLoadedAuthTokenPayload:mocks.build}));
import {mistApprovalAuthority} from './context';
const actor={userId:'owner',roles:[],permissions:['orders:write'],departmentIds:[]} as any;
beforeEach(()=>{mocks.resolve.mockReset();mocks.dept.mockReset();mocks.claim.mockReset();mocks.claim.mockRejectedValue(Object.assign(new Error('none'),{code:'NO_REVIEWER_RESOLVED'}));mocks.users.clear();mocks.build.mockReset();mocks.build.mockImplementation(async(_db:any,user:any,companyId?:string)=>({userId:user.id,companyId,roles:[],departmentIds:[],permissions:user.permissions,authorizationLoaded:true}));vi.stubEnv('MIST_LOCAL_WORKSPACE','0');vi.stubEnv('NODE_ENV','test');});
afterEach(()=>vi.unstubAllEnvs());
describe('Mist order reviewer authority',()=>{
 it('uses both built-in local identities for both domains without querying the old account database',async()=>{vi.stubEnv('MIST_LOCAL_WORKSPACE','1');const value=await mistApprovalAuthority({}, {...actor,mistLocal:true},'order.governance.submit');expect(value.orderReviewerIds).toEqual({garment:['local-operator','local-reviewer','local-manager'],fabric:['local-operator','local-reviewer','local-manager']});expect(mocks.resolve).not.toHaveBeenCalled();});
 it.each(['order.governance.decide','fulfillment.production.intake','fulfillment.production.intake.decide'])('reuses business-domain eligibility and filters revoked or inactive ordinary accounts for %s',async kind=>{mocks.resolve.mockImplementation(async(_db,domain)=>domain==='garment'?['garment-reviewer','revoked','inactive']:['fabric-reviewer']);for(const id of ['garment-reviewer','fabric-reviewer'])mocks.users.set(id,{id,status:'active',permissions:['orders:write']});mocks.users.set('revoked',{id:'revoked',status:'active',permissions:[]});mocks.users.set('inactive',{id:'inactive',status:'disabled',permissions:['orders:write']});const value=await mistApprovalAuthority({},actor,kind);expect(value.orderReviewerIds).toEqual({garment:['garment-reviewer'],fabric:['fabric-reviewer']});expect(mocks.resolve.mock.calls.map(call=>call[1])).toEqual(['garment','fabric']);});
 it('leaves an unconfigured domain unavailable rather than inventing a reviewer',async()=>{mocks.resolve.mockRejectedValue(Object.assign(new Error('missing'),{code:'ORDER_APPROVAL_AUTHORITY_MISSING'}));expect((await mistApprovalAuthority({},actor,'order.governance.submit')).orderReviewerIds).toEqual({garment:[],fabric:[]});});
});
describe('company leadership fallback for order governance',()=>{
 it.each(['order.governance.requestCancel','order.governance.decideCancel','fulfillment.production.intake','fulfillment.production.intake.decide'])('keeps the supervisor and independently routed company leader eligible for %s',async kind=>{
  mocks.resolve.mockImplementation(async(_db,domain)=>domain==='garment'?['head']:[]);
  mocks.users.set('head',{id:'head',status:'active',permissions:['orders:write']});mocks.users.set('leader',{id:'leader',status:'active',permissions:['orders:write']});
  mocks.dept.mockResolvedValue({reviewerId:'leader'});
  const value=await mistApprovalAuthority({}, {...actor,userId:kind.endsWith('requestCancel')?'head':'leader',companyId:'company-a'},kind,['head','leader']);
  expect(value.orderReviewerIds).toEqual({garment:['head','leader'],fabric:[]});expect(mocks.dept).toHaveBeenCalledWith('head');
  for(const call of mocks.build.mock.calls)expect(call[2]).toBe('company-a');
 });
 it.each(['revoked','disabled','outside-workspace','self'])('does not nominate a %s fallback',async condition=>{
  mocks.resolve.mockResolvedValue(['head']);mocks.users.set('head',{id:'head',status:'active',permissions:['orders:write']});
  mocks.users.set('leader',{id:'leader',status:condition==='disabled'?'disabled':'active',permissions:condition==='revoked'?[]:['orders:write']});
  mocks.dept.mockResolvedValue({reviewerId:condition==='self'?'head':'leader'});
  const value=await mistApprovalAuthority({}, {...actor,companyId:'company-a'},'order.governance.requestCancel',condition==='outside-workspace'?['head']:['head','leader']);
  expect(value.orderReviewerIds).toEqual({garment:['head'],fabric:['head']});
 });
 it('keeps configured approval available when no valid upper leader exists',async()=>{
  mocks.resolve.mockResolvedValue(['head']);mocks.users.set('head',{id:'head',status:'active',permissions:['orders:write']});mocks.dept.mockRejectedValue(Object.assign(new Error('none'),{code:'NO_REVIEWER_RESOLVED'}));
  expect((await mistApprovalAuthority({},actor,'order.governance.submit')).orderReviewerIds).toEqual({garment:['head'],fabric:['head']});
 });
});
describe('Mist payment request reviewer authority',()=>{
 it('local identities use the sales-manager test profile',async()=>{vi.stubEnv('MIST_LOCAL_WORKSPACE','1');expect((await mistApprovalAuthority({},{...actor,mistLocal:true},'payable.request.submit')).paymentReviewerIds).toEqual(['local-manager','local-reviewer']);});
 it('uses the requester department head only while that account still holds payment-request approval',async()=>{
  mocks.dept.mockResolvedValue({reviewerId:'head'});mocks.users.set('head',{id:'head',status:'active',permissions:['finance:payment_request:approve']});
  expect((await mistApprovalAuthority({},actor,'payable.request.submit')).paymentReviewerIds).toEqual(['head']);
  mocks.users.set('head',{id:'head',status:'active',permissions:['procurement:approve']});
  expect((await mistApprovalAuthority({},actor,'payable.request.decide')).paymentReviewerIds).toEqual([]);
  mocks.dept.mockResolvedValue({reviewerId:'owner'});mocks.users.set('owner',{id:'owner',status:'active',permissions:['finance:payment_request:approve']});
  expect((await mistApprovalAuthority({},actor,'payable.request.submit')).paymentReviewerIds).toEqual([]);
  mocks.dept.mockRejectedValue(Object.assign(new Error('none'),{code:'NO_REVIEWER_RESOLVED'}));
  expect((await mistApprovalAuthority({},actor,'payable.request.submit')).paymentReviewerIds).toEqual([]);
 });
});
describe('Mist risk handling and reviewer authority',()=>{
 it('rebuilds handling capability from the current account permissions only for risk commands',async()=>{
  mocks.dept.mockRejectedValue(Object.assign(new Error('none'),{code:'NO_REVIEWER_RESOLVED'}));
  expect((await mistApprovalAuthority({},{...actor,permissions:['risk:read','orders:write','relations:write']},'platform.risk.save')).risk).toEqual({all:false,orders:true,customers:true});
  expect((await mistApprovalAuthority({},{...actor,permissions:['risk:read','risk:write']},'platform.risk.transition')).risk).toEqual({all:true,orders:false,customers:false});
  expect((await mistApprovalAuthority({},actor,'payable.request.submit')).risk).toBeUndefined();
 });
 it('uses the requester department head only while active, not the requester, and still holding risk:write',async()=>{
  mocks.dept.mockResolvedValue({reviewerId:'head'});mocks.users.set('head',{id:'head',status:'active',permissions:['risk:write']});
  expect((await mistApprovalAuthority({},actor,'platform.risk.escalate')).riskReviewerIds).toEqual(['head']);
  mocks.users.set('head',{id:'head',status:'active',permissions:['risk:read']});
  expect((await mistApprovalAuthority({},actor,'platform.risk.decide')).riskReviewerIds).toEqual([]);
  mocks.users.set('head',{id:'head',status:'disabled',permissions:['risk:write']});
  expect((await mistApprovalAuthority({},actor,'platform.risk.escalate')).riskReviewerIds).toEqual([]);
  mocks.dept.mockResolvedValue({reviewerId:'owner'});mocks.users.set('owner',{id:'owner',status:'active',permissions:['risk:write']});
  expect((await mistApprovalAuthority({},actor,'platform.risk.escalate')).riskReviewerIds).toEqual([]);
  mocks.dept.mockRejectedValue(Object.assign(new Error('none'),{code:'NO_REVIEWER_RESOLVED'}));
  expect((await mistApprovalAuthority({},actor,'platform.risk.escalate')).riskReviewerIds).toEqual([]);
 });
 it('local identities route risk requests to the sales-manager test profile',async()=>{vi.stubEnv('MIST_LOCAL_WORKSPACE','1');const value=await mistApprovalAuthority({},{...actor,mistLocal:true,permissions:['risk:read','orders:write']},'platform.risk.escalate');expect(value.riskReviewerIds).toEqual(['local-manager','local-reviewer']);expect(value.risk).toEqual({all:false,orders:true,customers:false});});
});

describe('company context across approval transaction callbacks',()=>{
 it.each(['payable.request.submit','platform.risk.escalate','order.governance.submit','fulfillment.procurement.submit'])('passes the authenticated company explicitly for %s',async kind=>{
  const companyId='company-a';mocks.users.set('head',{id:'head',status:'active',permissions:['finance:payment_request:approve','risk:write','orders:write','procurement:approve']});mocks.dept.mockResolvedValue({reviewerId:'head'});mocks.resolve.mockResolvedValue(['head']);
  mocks.build.mockImplementation(async(_db:any,user:any,scope?:string)=>{if(scope!==companyId)throw new Error('Company context was lost');return{userId:user.id,companyId:scope,roles:[],departmentIds:[],globalBusinessScope:true,permissions:user.permissions,authorizationLoaded:true};});
  const db={systemConfig:{findUnique:async()=>({version:1,value:{schemaVersion:1,userIds:['head']}})}};
  await mistApprovalAuthority(db,{...actor,companyId},kind);expect(mocks.build).toHaveBeenCalled();for(const call of mocks.build.mock.calls)expect(call[2]).toBe(companyId);
 });
 it('does not fall back to an unscoped reviewer when company membership is denied',async()=>{
  mocks.dept.mockResolvedValue({reviewerId:'outsider'});mocks.users.set('outsider',{id:'outsider',status:'active',permissions:['finance:payment_request:approve']});
  mocks.build.mockRejectedValue(Object.assign(new Error('outside company'),{code:'COMPANY_ACCESS_DENIED'}));
  await expect(mistApprovalAuthority({}, {...actor,companyId:'company-a'},'payable.request.submit')).rejects.toMatchObject({code:'COMPANY_ACCESS_DENIED'});
 });
});

describe('Mist claim leader authority',()=>{
 it('keeps the current company and checks the leader current approval grant before nomination',async()=>{
  mocks.claim.mockResolvedValue({reviewerId:'leader'});mocks.users.set('leader',{id:'leader',status:'active',permissions:['aftersales:approve']});
  expect((await mistApprovalAuthority({},{...actor,companyId:'company-a'},'platform.claim.submit')).claimReviewerId).toBe('leader');
  expect(mocks.build).toHaveBeenCalledWith({},mocks.users.get('leader'),'company-a');
  mocks.users.set('leader',{id:'leader',status:'active',permissions:['aftersales:write']});
  expect((await mistApprovalAuthority({},actor,'platform.claim.decide')).claimReviewerId).toBeUndefined();
  mocks.users.set('leader',{id:'leader',status:'disabled',permissions:['aftersales:approve']});
  expect((await mistApprovalAuthority({},actor,'platform.claim.submit')).claimReviewerId).toBeUndefined();
  mocks.claim.mockResolvedValue({reviewerId:'owner'});mocks.users.set('owner',{id:'owner',status:'active',permissions:['aftersales:approve']});
  expect((await mistApprovalAuthority({},actor,'platform.claim.submit')).claimReviewerId).toBeUndefined();
 });
});

describe('company order approval without duplicate legacy configuration',()=>{
 it('routes a supervisor request to existing company leadership in the matching business domain',async()=>{
  mocks.resolve.mockRejectedValue(Object.assign(new Error('missing'),{code:'ORDER_APPROVAL_AUTHORITY_MISSING'}));
  mocks.users.set('gm',{id:'gm',status:'active',permissions:['orders:write'],globalBusinessScope:true});
  mocks.dept.mockResolvedValue({reviewerId:'gm'});
  mocks.build.mockImplementation(async(_db,user,companyId)=>({...user,userId:user.id,companyId,roles:[],departmentIds:[],authorizationLoaded:true}));
  const result=await mistApprovalAuthority({}, {...actor,userId:'supervisor',companyId:'company-a'},'order.governance.submit',['supervisor','gm']);
  expect(result.orderReviewerIds).toEqual({garment:['gm'],fabric:['gm']});
  expect(mocks.dept).toHaveBeenCalledWith('supervisor');
 });
 it.each(['inactive','revoked','different-domain','not-a-member','self'])('does not use %s as a company order reviewer',async condition=>{
  mocks.resolve.mockResolvedValue([]);
  mocks.users.set('candidate',{id:'candidate',status:condition==='inactive'?'disabled':'active',permissions:condition==='revoked'?[]:['orders:write'],businessAttributes:condition==='different-domain'?['finance']:['garment_business']});
  mocks.users.set('supervisor',{id:'supervisor',status:'active',permissions:['orders:write'],businessAttributes:['garment_business']});
  mocks.build.mockImplementation(async(_db,user,companyId)=>({...user,userId:user.id,companyId,roles:[],departmentIds:[],authorizationLoaded:true}));
  mocks.dept.mockResolvedValue({reviewerId:condition==='self'?'supervisor':'candidate'});
  const result=await mistApprovalAuthority({}, {...actor,userId:'supervisor',companyId:'company-a'},'order.governance.submit',condition==='not-a-member'?['supervisor']:['supervisor','candidate']);
  expect(result.orderReviewerIds).toEqual({garment:[],fabric:[]});
 });
});

describe('company procurement authority isolation',()=>{
 it('saves drafts without loading unrelated approval configuration or reviewer accounts',async()=>{
  mocks.users.set('foreign',{id:'foreign',status:'active',permissions:['procurement:approve']});
  mocks.build.mockRejectedValue(Object.assign(new Error('foreign company'),{code:'COMPANY_ACCESS_DENIED'}));
  const findUnique=vi.fn(async()=>({version:1,value:{schemaVersion:1,userIds:['foreign']}}));
  await expect(mistApprovalAuthority({systemConfig:{findUnique}},{...actor,companyId:'company-a'},'fulfillment.procurement.save',['owner','leader'])).resolves.toEqual({supplier:{}});
  expect(findUnique).not.toHaveBeenCalled();expect(mocks.build).not.toHaveBeenCalled();
 });
 it('ignores foreign legacy nominees and routes approval to the current company leader',async()=>{
  mocks.users.set('foreign',{id:'foreign',status:'active',permissions:['procurement:approve']});
  mocks.users.set('leader',{id:'leader',status:'active',permissions:['procurement:approve'],globalBusinessScope:true});
  mocks.build.mockImplementation(async(_db,user,companyId)=>{if(user.id==='foreign')throw Object.assign(new Error('foreign company'),{code:'COMPANY_ACCESS_DENIED'});return {...user,userId:user.id,companyId,departmentIds:[],authorizationLoaded:true};});
  mocks.dept.mockResolvedValue({reviewerId:'leader'});
  const db={systemConfig:{findUnique:async()=>({version:3,value:{schemaVersion:1,userIds:['foreign']}})}};
  const value=await mistApprovalAuthority(db,{...actor,companyId:'company-a'},'fulfillment.procurement.submit',['owner','leader']);
  expect(value.supplier['supplierCommitment.approvers.purchase.garment']?.userIds).toEqual(['leader']);
  expect(mocks.build.mock.calls.some(call=>call[1].id==='foreign')).toBe(false);
 });
});

it('keeps procurement fallback within current members, matching business domain and current permission',async()=>{
 mocks.users.set('foreign',{id:'foreign',status:'active',permissions:['procurement:approve'],businessAttributes:['garment_business']});
 mocks.users.set('leader',{id:'leader',status:'active',permissions:['procurement:approve'],businessAttributes:['garment_business']});
 mocks.build.mockImplementation(async(_db,user,companyId)=>({...user,userId:user.id,companyId,departmentIds:[],authorizationLoaded:true}));
 mocks.dept.mockResolvedValue({reviewerId:'leader'});
 const db={companyMember:{findFirst:async({where}:any)=>where.userId==='foreign'?null:{companyId:where.companyId}},systemConfig:{findUnique:async()=>({version:1,value:{schemaVersion:1,userIds:['foreign']}})}};
 const args=[db,{...actor,companyId:'company-a'},'fulfillment.procurement.submit',['owner','leader','foreign']] as const;
 const value=await mistApprovalAuthority(...args);
 expect(value.supplier['supplierCommitment.approvers.purchase.garment']?.userIds).toEqual(['leader']);
 expect(value.supplier['supplierCommitment.approvers.purchase.fabric']?.userIds).toEqual([]);
 expect(mocks.build.mock.calls.some(call=>call[1].id==='foreign')).toBe(false);
 mocks.users.get('leader').permissions=[];
 expect((await mistApprovalAuthority(...args)).supplier['supplierCommitment.approvers.purchase.garment']?.userIds).toEqual([]);
});
