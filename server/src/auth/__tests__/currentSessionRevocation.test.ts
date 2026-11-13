import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {expect,it,vi} from 'vitest';
import {createAuthService} from '../service';
import {requireAuth} from '../middleware';
import {createCurrentSessionGuard,currentSessionKey} from '../currentSessionRevocation';
const auth=createAuthService(),claims=(userId='u',sessionId='device')=>({userId,sessionId,roles:[],permissions:[],departmentIds:[]});
function setup(){const rows=new Map<string,any>(),findUnique=vi.fn(async({where}:any)=>rows.get(where.id)||null),store:any={authSessionRevocation:{findUnique}},a=express();a.use(cookieParser());a.use('/api',createCurrentSessionGuard(store));a.use('/api',createCurrentSessionGuard(store));a.get('/api/private',requireAuth,(_req,res)=>res.json({ok:true}));return{a,store,rows,findUnique};}
it('checks shared storage on every request, while avoiding duplicate guards within one request',async()=>{
 const{a,rows,findUnique}=setup(),c=claims(),token=auth.signToken(c);expect((await request(a).get('/api/private').auth(token,{type:'bearer'})).status).toBe(200);expect(findUnique).toHaveBeenCalledTimes(1);
 rows.set(currentSessionKey(c)!,{expiresAt:new Date(Date.now()+3600000)});expect((await request(a).get('/api/private').auth(token,{type:'bearer'})).status).toBe(401);expect(findUnique).toHaveBeenCalledTimes(2);
});
it('fails closed when current-session storage cannot be checked',async()=>{
 const{a,findUnique}=setup();findUnique.mockRejectedValue(Error('unavailable'));const r=await request(a).get('/api/private').auth(auth.signToken(claims()),{type:'bearer'});expect(r.status).toBe(503);expect(r.body.error).toBe('SESSION_STATUS_UNAVAILABLE');
});
it('does not confuse another user with the same session identifier',async()=>{
 const{a,rows}=setup(),first=claims('one'),other=claims('two');rows.set(currentSessionKey(first)!,{expiresAt:new Date(Date.now()+3600000)});expect((await request(a).get('/api/private').auth(auth.signToken(first),{type:'bearer'})).status).toBe(401);expect((await request(a).get('/api/private').auth(auth.signToken(other),{type:'bearer'})).status).toBe(200);
});
it('does not treat an invalid token or a purpose token as a login session',async()=>{
 const{a,findUnique}=setup();for(const token of ['invalid',auth.signPurposeToken('mfa','subject',60)])expect((await request(a).get('/api/private').auth(token,{type:'bearer'})).status).toBe(401);expect(findUnique).not.toHaveBeenCalled();
});
it.each(['/api/health','/api/mist/session'])('keeps public discovery independent of a revoked cookie at %s',async path=>{
 const{a,rows,findUnique}=setup(),c=claims(),token=auth.signToken(c);rows.set(currentSessionKey(c)!,{expiresAt:new Date(Date.now()+3600000)});a.get(path,(_req,res)=>res.json({mode:'remote'}));const r=await request(a).get(path).set('Cookie','bambook_token='+token);expect(r.status).toBe(200);expect(findUnique).not.toHaveBeenCalled();
});
it('does not bypass revocation on a private path ending in an auth-like suffix',async()=>{
 const{a,rows}=setup(),c=claims(),token=auth.signToken(c);rows.set(currentSessionKey(c)!,{expiresAt:new Date(Date.now()+3600000)});a.get('/api/private/auth/logout',requireAuth,(_req,res)=>res.json({ok:true}));expect((await request(a).get('/api/private/auth/logout').auth(token,{type:'bearer'})).status).toBe(401);
});
