import {expect,it,vi} from 'vitest';
import {buildLoadedAuthTokenPayload} from '../tokenHelpers';
import {hasScope} from '../permissionService';
import {companyDataScope,companyWideActor} from '../../mist/companyLibrary';
import {COMPANY_ADMINISTRATION_SCOPES,companyAdministratorIds,isCompanyAdministrator} from '../companyAdministration';

const companyId='company-a',userId='business-operator';
function fixture(administrator=true,code='role-sales'){
 const department={id:'sales-dept',companyId,parentId:'company',status:'active',metadata:{businessAttributes:['garment_business']}};
 const role={id:code+'@'+companyId,code,companyId,name:'业务员',permissions:[{permission:{scope:'orders:read'}},{permission:{scope:'orders:write'}}]};
 const user={id:userId,status:'active',deletedAt:null,displayName:'业务员',platformRole:null,metadata:{},primaryDepartment:department,primaryDeptId:department.id,roles:[{roleId:role.id,role,department,departmentId:department.id}]};
 const membership={userId,companyId,status:'active',company:{id:companyId,status:'active',name:'模拟测试公司',slug:'simulation-test',settings:administrator?{administratorIds:[userId]}:{}}};
 const db:any={companyMember:{findFirst:vi.fn(async()=>membership)},userPermissionOverrides:{findMany:vi.fn(async()=>[])},teamMember:{findMany:vi.fn(async()=>[])},department:{findMany:vi.fn(async()=>[])}};
 return {db,user,membership};
}
it('adds system management responsibility without making a salesperson a business leader',async()=>{
 const f=fixture(),actor=await buildLoadedAuthTokenPayload(f.db,f.user,companyId);
 for(const scope of COMPANY_ADMINISTRATION_SCOPES)expect(actor.permissions).toContain(scope);
 expect(actor.globalBusinessScope).toBe(false);expect(companyWideActor(actor)).toBe(false);expect(actor.roles).not.toContain('owner');
 for(const scope of ['invoices:write','vouchers:write','qc:inspect','orders:approve','shipments:write','vouchers:approve:pay_gt5'])expect(hasScope(actor,scope as any),scope).toBe(false);
 const scope=await companyDataScope(f.db,{companyId,state:{memberIds:[userId]} as any},actor);expect(scope?.userIds).toEqual([userId]);
});
it('does not infer administration from a simulation-like company or a mailbox',async()=>{
 const f=fixture(false);f.user.displayName='公司管理员';(f.user as any).email='owner@simulation.example.invalid';
 const actor=await buildLoadedAuthTokenPayload(f.db,f.user,companyId);expect(hasScope(actor,'users:admin' as any)).toBe(false);expect(actor.globalBusinessScope).toBe(false);
});
it('keeps explicit general-manager business authority separate',async()=>{
 const f=fixture(false,'role-super-admin'),actor=await buildLoadedAuthTokenPayload(f.db,f.user,companyId);
 expect(actor.globalBusinessScope).toBe(true);expect(companyWideActor(actor)).toBe(true);expect(hasScope(actor,'orders:approve' as any)).toBe(true);
});
it('requires a matching active membership and explicit administrator configuration',()=>{
 const f=fixture();expect(isCompanyAdministrator(f.membership,userId)).toBe(true);
 expect(isCompanyAdministrator({...f.membership,userId:'another'},userId)).toBe(false);
 expect(isCompanyAdministrator({...f.membership,status:'left'},userId)).toBe(false);
 expect(companyAdministratorIds({administratorIds:[null,userId,userId,3]})).toEqual([userId]);
});
