import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({resolve:vi.fn(),dept:vi.fn(),users:new Map<string,any>(),build:vi.fn()}));
vi.mock('../approvals/approvalRoutingService',()=>({createApprovalRoutingService:()=>({resolveReviewerByDepartment:mocks.dept,resolveClaimLeader:vi.fn()})}));
vi.mock('../orders/orderMainApprovalService',()=>({createOrderMainApprovalService:()=>({resolveEligibleReviewerIds:mocks.resolve})}));
vi.mock('../auth/tokenHelpers',()=>({loadUserWithRoles:async(_db:any,id:string)=>mocks.users.get(id)||null,buildLoadedAuthTokenPayload:mocks.build}));
import {mistApprovalAuthority} from './context';
const actor={userId:'owner',roles:[],permissions:['orders:write'],departmentIds:[]} as any;
beforeEach(()=>{mocks.resolve.mockReset();mocks.dept.mockReset();mocks.users.clear();mocks.build.mockReset();mocks.build.mockImplementation(async(_db:any,user:any,companyId?:string)=>({userId:user.id,companyId,roles:[],departmentIds:[],permissions:user.permissions,authorizationLoaded:true}));vi.stubEnv('MIST_LOCAL_WORKSPACE','0');vi.stubEnv('NODE_ENV','test');});
afterEach(()=>vi.unstubAllEnvs());
describe('Mist order reviewer authority',()=>{
 it('uses both built-in local identities for both domains without querying the old account database',async()=>{vi.stubEnv('MIST_LOCAL_WORKSPACE','1');const value=await mistApprovalAuthority({}, {...actor,mistLocal:true},'order.governance.submit');expect(value.orderReviewerIds).toEqual({garment:['local-operator','local-reviewer','local-manager'],fabric:['local-operator','local-reviewer','local-manager']});expect(mocks.resolve).not.toHaveBeenCalled();});
 it('reuses business-domain eligibility and filters revoked or inactive ordinary accounts',async()=>{mocks.resolve.mockImplementation(async(_db,domain)=>domain==='garment'?['garment-reviewer','revoked','inactive']:['fabric-reviewer']);for(const id of ['garment-reviewer','fabric-reviewer'])mocks.users.set(id,{id,status:'active',permissions:['orders:write']});mocks.users.set('revoked',{id:'revoked',status:'active',permissions:[]});mocks.users.set('inactive',{id:'inactive',status:'disabled',permissions:['orders:write']});const value=await mistApprovalAuthority({},actor,'order.governance.decide');expect(value.orderReviewerIds).toEqual({garment:['garment-reviewer'],fabric:['fabric-reviewer']});expect(mocks.resolve.mock.calls.map(call=>call[1])).toEqual(['garment','fabric']);});
 it('leaves an unconfigured domain unavailable rather than inventing a reviewer',async()=>{mocks.resolve.mockRejectedValue(Object.assign(new Error('missing'),{code:'ORDER_APPROVAL_AUTHORITY_MISSING'}));expect((await mistApprovalAuthority({},actor,'order.governance.submit')).orderReviewerIds).toEqual({garment:[],fabric:[]});});
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
