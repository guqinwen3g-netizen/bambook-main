import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthService, type TokenPayload } from '../service';
import { currentSessionKey } from '../currentSessionRevocation';
import { hasScope } from '../permissionService';
import { newSession, writeSession } from '../sessionLifetime';
import { isTokenRevoked } from '../sessionRevocation';

const auth=createAuthService();
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-15T04:00:00Z'));});
afterEach(()=>vi.useRealTimers());
function issue(remember=true,patch:Partial<TokenPayload>={}){
 const permissions=['orders:read','orders:write',...Array.from({length:180},(_,i)=>`business-module-${i}:read`)];
 const payload:TokenPayload={userId:'cookie-budget-user',companyId:'company-one',displayName:'Staff',roles:['owner'],roleIds:['role-super-admin'],permissions,grantedPermissions:permissions,departmentIds:['department-one'],businessAttributes:['fabric_business'],globalBusinessScope:true,authorizationLoaded:true,credentialVersion:'credential-v1',credentialIssuedAt:Math.floor(Date.now()/1000)-60,...patch};
 let stored!: {name:string;token:string;options:any};
 const res={cookie:(name:string,token:string,options:any)=>{stored={name,token,options};}} as unknown as Response;
 const session=newSession(remember),token=writeSession(res,auth,payload,session);
 return {payload,token,stored,body:auth.verifyToken(token),cookie:auth.verifyToken(stored.token),session};
}

describe('bounded browser session credentials',()=>{
 it('keeps a large authorization response while fitting the browser cookie budget',()=>{
  const f=issue();expect(Buffer.byteLength(f.token)).toBeGreaterThan(4096);
  expect(Buffer.byteLength(f.stored.name+'='+f.stored.token)).toBeLessThan(4096);
  expect(f.body.permissions).toEqual(f.payload.permissions);expect(f.body.grantedPermissions).toEqual(f.payload.grantedPermissions);
 });

 it('carries no authorization snapshot or legacy role fallback before current grants load',()=>{
  const f=issue();expect(f.cookie.roles).toEqual([]);expect(f.cookie.permissions).toEqual([]);expect(f.cookie.departmentIds).toEqual([]);
  expect(f.cookie.roleIds).toBeUndefined();expect(f.cookie.grantedPermissions).toBeUndefined();expect(f.cookie.globalBusinessScope).toBeUndefined();expect(f.cookie.businessAttributes).toBeUndefined();
  expect(f.cookie.authorizationLoaded).toBe(true);expect(hasScope(f.cookie,'orders:read')).toBe(false);expect(hasScope(f.cookie,'orders:write')).toBe(false);
 });

 it.each([[undefined],[[]],[['orders:read']]] as Array<[string[]|undefined]>)('retains signed company/platform/credential/session bounds and ceiling %j',permissionCeiling=>{
  const platformCompany={companyId:'company-one',companyName:'Company',startedAt:'2026-11-15T03:00:00Z'};
  const f=issue(true,{permissionCeiling,platformOnly:true,platformCompany});
  for(const key of ['userId','companyId','credentialVersion','credentialIssuedAt','sessionId','authTime','remember','platformOnly','platformCompany','permissionCeiling'] as const)expect(f.cookie[key]).toEqual(f.body[key]);
  expect(currentSessionKey(f.cookie,f.stored.token)).toBe(currentSessionKey(f.body,f.token));
  expect(isTokenRevoked({credentialVersion:'credential-v2'},(f.cookie as any).iat,f.cookie.credentialVersion)).toBe(true);
 });

 it.each([true,false])('preserves lifetime and cookie protections for remember=%s',remember=>{
  const f=issue(remember),ttl=remember?30*86400:12*3600;
  expect((f.cookie as any).exp-(f.cookie as any).iat).toBe(ttl);expect((f.cookie as any).exp).toBe((f.body as any).exp);
  expect(f.stored.options).toMatchObject({httpOnly:true,sameSite:'lax',path:'/'});
  expect(f.stored.options.secure).toBe(process.env.NODE_ENV==='production');
  if(remember)expect(f.stored.options.maxAge).toBe(ttl*1000);else expect(f.stored.options.maxAge).toBeUndefined();
 });

 it('uses the same issuance boundary when the two signatures cross a clock tick',()=>{
  let cookie='',calls=0;
  const signer={signToken:(payload:TokenPayload,options?:{expiresInSec?:number})=>{const token=auth.signToken(payload,options);if(++calls===1)vi.setSystemTime(new Date(Date.now()+2000));return token;}};
  const token=writeSession({cookie:(_name:string,value:string)=>{cookie=value;}} as unknown as Response,signer,{userId:'tick-user',roles:['sales'],permissions:['orders:read'],departmentIds:[]},newSession(true));
  const body=auth.verifyToken(token) as any,credential=auth.verifyToken(cookie) as any;
  expect(credential.iat).toBe(body.iat);expect(credential.exp).toBe(body.exp);
 });
});
