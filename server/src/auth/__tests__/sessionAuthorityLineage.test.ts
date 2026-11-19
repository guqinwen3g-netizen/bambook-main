import express from 'express';
import request from 'supertest';
import {expect,it} from 'vitest';
import {createAuthService} from '../service';
import {createAuthorizationSnapshotGuard} from '../authorizationSnapshotGuard';
import {createCurrentSessionGuard,revokeCurrentSession} from '../currentSessionRevocation';
import {freshMistAuthority} from '../../mist/authority';
import {sessionRevocationStore} from './sessionRevocationStore';
import {buildLoadedAuthTokenPayload} from '../tokenHelpers';

it.each(['modern','legacy','timestamp'])('keeps %s session identity through grant hydration and denies a revoked queued write',async format=>{
 const user={id:'lineage-'+format,status:'active',deletedAt:null,metadata:{},primaryDeptId:null,primaryDepartment:null,roles:[{roleId:'custom',departmentId:null,role:{id:'custom',name:'Custom',isSystem:false,permissions:[{permission:{scope:'orders:write'}}]}}]};
 const db:any={authSessionRevocation:sessionRevocationStore(),userAccount:{findFirst:async()=>structuredClone(user),findUnique:async()=>structuredClone(user)},userPermissionOverrides:{findMany:async()=>[]},department:{findMany:async()=>[]}};
 await buildLoadedAuthTokenPayload(db,user as any);
 const auth=createAuthService(),token=auth.signToken({userId:user.id,roles:['viewer'],permissions:[],departmentIds:[],...(format==='modern'?{sessionId:'device-a',authTime:Math.floor(Date.now()/1000),remember:true}:{})});
 let writes=0;const app=express();app.use('/api',createCurrentSessionGuard(db));app.use('/api',createAuthorizationSnapshotGuard({prisma:db}));app.post('/api/write',async(req,res)=>{try{
  // Another request's logout committed after this request entered, before its business transaction authorizes the write.
  if(format==='timestamp')user.metadata={sessionsRevokedAt:new Date(Date.now()+2000).toISOString()};else await revokeCurrentSession(db,auth.verifyToken(token),token);await freshMistAuthority(db,(req as any).actor);writes++;res.json({ok:true});
 }catch(error:any){res.status(error.status||500).json({error:error.code});}});
 const result=await request(app).post('/api/write').auth(token,{type:'bearer'});expect(result.status).toBe(401);expect(result.body.error).toBe('SESSION_REVOKED');expect(writes).toBe(0);
});
