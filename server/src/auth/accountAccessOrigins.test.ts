import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccountAccessService } from './accountAccess';
function fixture(platform:boolean) {
  const user:any={id:'test-user',email:'test@example.invalid',status:'active',deletedAt:null,platformRole:platform?'platform_admin':null,companyMembers:platform?[]:[{status:'active',company:{status:'active'}}],roles:[],metadata:{forceChangePassword:true}};
  const send=vi.fn(async(_message: import('./email').EmailMessage)=>{});
  const tx:any={$executeRaw:vi.fn(),userAccount:{findUnique:vi.fn(async()=>user),update:vi.fn(async({data}:any)=>{Object.assign(user,data);return user;})},userVerificationCode:{upsert:vi.fn()},auditLog:{create:vi.fn()}};
  const db:any={$transaction:async(fn:any)=>fn(tx)};
  return{db,send};
}
afterEach(()=>vi.unstubAllEnvs());
describe('account mail origins',()=>{
  it.each([false,true])('sends a role-correct access link (platform=%s)',async platform=>{
    const f=fixture(platform);
    const result=await createAccountAccessService(f.db,{email:{isReal:true,describe:()=> 'isolated capture',send:f.send},publicUrl:'https://company.example.test',platformPublicUrl:'https://admin.example.test'}).deliver('test-user','invite');
    expect(result.status).toBe('sent');
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]?.[0]?.text).toContain(platform?'https://admin.example.test/':'https://company.example.test/');
  });
  it('retains the existing single-origin fallback when no platform URL is configured',async()=>{
    vi.stubEnv('BAMBOOK_PLATFORM_PUBLIC_URL','');
    const f=fixture(true);
    expect((await createAccountAccessService(f.db,{email:{isReal:true,describe:()=> 'isolated capture',send:f.send},publicUrl:'https://local.example.test'}).deliver('test-user','recovery')).status).toBe('sent');
    expect(f.send.mock.calls[0]?.[0]?.text).toContain('https://local.example.test/');
  });
  it('rejects credential-bearing or non-HTTPS public URLs before creating a token',async()=>{
    const f=fixture(true);
    const result=await createAccountAccessService(f.db,{email:{isReal:true,describe:()=> 'isolated capture',send:f.send},publicUrl:'https://company.example.test',platformPublicUrl:'https://user:password@admin.example.test'}).deliver('test-user','invite');
    expect(result.status).toBe('unavailable');expect(f.send).not.toHaveBeenCalled();
  });
});
