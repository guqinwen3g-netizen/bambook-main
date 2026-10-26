import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createMistServer } from '../mist/server';
import { createAuthService } from './service';

describe('public domains on the running Mist server', () => {
  const db:any = { $queryRawUnsafe: vi.fn(async()=>[]), userAccount: { findUnique: vi.fn(async()=>null) } };
  it('keeps remote-session discovery reachable on both entry hosts', async()=>{
    for(const host of ['bambook.sylway.cloud','bambook-admin.sylway.cloud']) {
      const res=await request(createMistServer(db)).get('/api/mist/session').set('Host',host);
      expect(res.status).toBe(404);
    }
  });
  it('refuses business workspace requests on the platform host before reading data',async()=>{
    const token=createAuthService().signToken({userId:'platform',platformOnly:true,roles:[],permissions:[],departmentIds:[]});
    const res=await request(createMistServer(db)).get('/api/mist/workspaces').set('Host','bambook-admin.sylway.cloud').set('Authorization','Bearer '+token);
    expect(res.status).toBe(403);expect(res.body.error).toBe('COMPANY_ENTRY_ONLY');
  });
  it('allows same-origin health checks without enabling cross-origin platform access',async()=>{
    const app=createMistServer(db);
    const own=await request(app).get('/api/health').set('Host','bambook-admin.sylway.cloud').set('Origin','https://bambook-admin.sylway.cloud');
    const cross=await request(app).get('/api/health').set('Host','bambook-admin.sylway.cloud').set('Origin','https://bambook.sylway.cloud');
    expect(own.status).toBe(200);expect(own.headers['access-control-allow-origin']).toBe('https://bambook-admin.sylway.cloud');
    expect(cross.headers['access-control-allow-origin']).toBeUndefined();
  });
});
