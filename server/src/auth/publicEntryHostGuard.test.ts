import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createPublicEntryHostGuard } from './publicEntryHostGuard';

function app(actor?: Record<string, unknown>, surface: 'main' | 'mist' = 'main') {
  const server=express();server.use(express.json());
  server.use((req,_res,next)=>{(req as any).actor=actor;next();});
  server.use('/api',createPublicEntryHostGuard(surface));
  server.use((_req,res)=>res.json({ok:true}));return server;
}
const admin='bambook-admin.sylway.cloud', company='bambook.sylway.cloud';
describe('public entry route boundary',()=>{
  it('keeps the platform API off the company domain',async()=>{
    expect((await request(app()).get('/api/platform/companies').set('Host',company)).status).toBe(403);
  });
  it('keeps business data off the platform domain',async()=>{
    expect((await request(app({platformOnly:true})).get('/api/mist/workspaces').set('Host',admin)).status).toBe(403);
    expect((await request(app({platformOnly:true},'mist')).get('/api/workspaces').set('Host',admin)).status).toBe(403);
  });
  it('allows platform operations and scoped platformCompany without adding company access',async()=>{
    expect((await request(app({platformOnly:true})).get('/api/platform/companies').set('Host',admin)).status).toBe(200);
    expect((await request(app({platformCompany:{id:'platformCompany'}})).get('/api/hr/personnel').set('Host',admin)).status).toBe(200);
    expect((await request(app({companyId:'a'})).get('/api/hr/personnel').set('Host',admin)).status).toBe(403);
  });
  it('does not accept platform or platformCompany tokens on the company origin',async()=>{
    for(const actor of [{platformOnly:true},{platformCompany:{id:'platformCompany'}}]) expect((await request(app(actor)).get('/api/auth/me').set('Host',company)).status).toBe(403);
  });
  it('allows only the existing platform AI configuration surface to platform sessions',async()=>{
    expect((await request(app({platformOnly:true},'mist')).get('/api/ai/platform-model').set('Host',admin)).status).toBe(200);
    expect((await request(app({platformCompany:{id:'platformCompany'}},'mist')).get('/api/ai/platform-model').set('Host',admin)).status).toBe(403);
    expect((await request(app({platformOnly:true},'mist')).get('/api/ai/chat').set('Host',admin)).status).toBe(403);
  });
  it('does not use a forwarded-host header as entry authority',async()=>{
    expect((await request(app()).get('/api/platform/companies').set('Host',company).set('X-Forwarded-Host',admin)).status).toBe(403);
  });
  it('rejects cross-origin calls to the platform with its own cookie session',async()=>{
    expect((await request(app({platformOnly:true})).get('/api/platform/companies').set('Host',admin).set('Origin','https://'+company)).status).toBe(403);
    expect((await request(app({platformOnly:true})).get('/api/platform/companies').set('Host',admin).set('Origin','https://'+admin)).status).toBe(200);
  });
  it('keeps company registration off the platform host',async()=>{
    expect((await request(app()).post('/api/auth/register/company').set('Host',admin)).status).toBe(403);
  });
  it('preserves local preview and the remote-session discovery response',async()=>{
    expect((await request(app()).get('/api/mist/session').set('Host',admin)).status).toBe(200);
    expect((await request(app()).get('/api/platform/companies').set('Host','localhost:3002')).status).toBe(200);
    expect((await request(app({platformOnly:true})).post('/api/auth/logout').set('Host',company)).status).toBe(200);
  });
});
