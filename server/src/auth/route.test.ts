import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAuthService } from './service';
import { createAuthRouter } from './route';

function authToken() {
  return createAuthService().signToken({
    userId: 'u1',
    displayName: 'User One',
    roles: ['viewer'],
    permissions: ['orders:read'],
    departmentIds: ['company'],
  });
}

function makeApp(prisma: any) {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use('/auth', createAuthRouter({ prisma, requireEmailVerification: false }));
  return app;
}

describe('auth profile avatar', () => {
  it('updates and returns the current user circular avatar data url', async () => {
    const prisma = {
      userAccount: {
        update: vi.fn().mockResolvedValue({
          id: 'u1',
          displayName: 'User One',
          status: 'active',
          email: 'user@example.com',
          avatarUrl: 'data:image/webp;base64,next',
          primaryDeptId: null,
          primaryDepartment: { name: 'Company' },
          roles: [{
            roleId: 'viewer', // Genuine historical role identity; Role.name alone grants no authority.
            departmentId: 'company',
            role: {
              name: 'viewer',
              isSystem: false,
              permissions: [{ permission: { scope: 'orders:read' } }],
            },
          }],
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      userPermissionOverrides: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const res = await request(makeApp(prisma))
      .patch('/auth/me')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ avatarUrl: 'data:image/webp;base64,next' });

    expect(res.status).toBe(200);
    expect(prisma.userAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: { avatarUrl: 'data:image/webp;base64,next' },
    }));
    expect(res.body.user).toMatchObject({
      id: 'u1',
      avatarUrl: 'data:image/webp;base64,next',
      department: 'Company',
      roles: ['viewer'],
      permissions: ['orders:read'],
    });
  });

  it('rejects oversized or non-image avatar payloads', async () => {
    const prisma = {
      userAccount: { update: vi.fn() },
      auditLog: { create: vi.fn() },
    };

    const res = await request(makeApp(prisma))
      .patch('/auth/me')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ avatarUrl: 'data:text/plain;base64,nope' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_AVATAR');
    expect(prisma.userAccount.update).not.toHaveBeenCalled();
  });
});

describe('editable avatar profile identities',()=>{
  it.each(['initials:v1:clay','person','pattern'])('saves a validated %s avatar on the authenticated account only',async kind=>{
    const {defaultPersonAvatar,personIdentity}=await import('../shared/avatarAppearance');
    const avatarUrl=kind==='person'?personIdentity({...defaultPersonAvatar('u1'),hair:'bun'}):kind==='pattern'?'dicebear:v1:glass:pblue_v8_12_12_test-0:still':kind;
    const prisma={userAccount:{update:vi.fn().mockImplementation(async({data})=>({id:'u1',displayName:'One',status:'active',email:'one@example.com',roles:[],primaryDeptId:null,primaryDepartment:null,...data}))},auditLog:{create:vi.fn().mockResolvedValue({})},userPermissionOverrides:{findMany:vi.fn().mockResolvedValue([])}};
    const response=await request(makeApp(prisma)).patch('/auth/me').set('Authorization',`Bearer ${authToken()}`).send({avatarUrl,userId:'someone-else'});
    expect(response.status).toBe(200);expect(response.body.user.avatarUrl).toBe(avatarUrl);
    expect(prisma.userAccount.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:'u1'},data:{avatarUrl}}));
  });
  it.each(['initials:v1:unknown','dicebear:v1:glass:punknown_v8_12_12_test-0:still','person:v1:%XX','person:v1:'+encodeURIComponent('{"seed":"test","svg":"<script>"}')])('rejects malformed custom identities: %s',async avatarUrl=>{
    const prisma={userAccount:{update:vi.fn()},auditLog:{create:vi.fn()}};
    const response=await request(makeApp(prisma)).patch('/auth/me').set('Authorization',`Bearer ${authToken()}`).send({avatarUrl});
    expect(response.status).toBe(400);expect(prisma.userAccount.update).not.toHaveBeenCalled();
  });
});
