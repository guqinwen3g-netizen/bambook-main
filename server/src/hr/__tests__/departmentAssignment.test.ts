import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createHRRouter } from '../route';
import { createAuthService } from '../../auth/service';
const companyAuthorization = 'Bearer ' + createAuthService().signToken({ userId: 'hr-admin', roles: [], permissions: ['hr:write'], departmentIds: [], companyId: 'company-a' });

describe('department assignment boundary', () => {
  for (const resource of ['teams']) {
    for (const method of ['post', 'patch'] as const) {
      for (const department of [null, { id: 'company', parentId: null, status: 'active' }, { id: 'closed', parentId: 'company', status: 'inactive' }]) {
        it(`${method} ${resource} rejects invalid department ${department?.id}`, async () => {
          const write = vi.fn();
          const prisma = {
            department: { findUnique: vi.fn().mockResolvedValue(department) },
            team: { create: write, update: write }, jobPosition: { create: write, update: write },
          };
          const app = express(); app.use(express.json());
          app.use('/hr', createHRRouter({ prisma: prisma as any, requireAuth: false }));
          const response = await request(app)[method](`/hr/${resource}${method === 'patch' ? '/existing' : ''}`)
            .send({ name: 'Test', title: 'Test', departmentId: department?.id ?? '' });
          expect(response.status).toBe(400);
          expect(write).not.toHaveBeenCalled();
        });
      }
    }
  }
  it.each(['post', 'patch'] as const)('%s cannot reference a foreign company leader even with a valid local department', async method => {
    const write = vi.fn();
    const prisma = {
      department: { findUnique: vi.fn().mockResolvedValue({ id: 'local-dept', parentId: 'company', status: 'active' }), findFirst: vi.fn().mockResolvedValue({ id: 'local-dept' }) },
      userAccount: { findFirst: vi.fn().mockResolvedValue(null) },
      team: { create: write, update: write },
    };
    const app = express(); app.use(express.json());
    app.use('/hr', createHRRouter({ prisma: prisma as any }));
    const response = await request(app)[method]('/hr/teams' + (method === 'patch' ? '/local-team' : ''))
      .set('Authorization', companyAuthorization).send({ name: 'Group', departmentId: 'local-dept', leaderId: 'foreign-user' });
    expect(response.status).toBe(404);
    expect(prisma.userAccount.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign-user', companyMembers: { some: { companyId: 'company-a', status: 'active' } } } });
    expect(write).not.toHaveBeenCalled();
  });
  it('the company-scoped department lookup prevents assigning a foreign department before any team write', async () => {
    const write = vi.fn(), lookup = vi.fn().mockResolvedValue(null);
    const app = express(); app.use(express.json());
    app.use('/hr', createHRRouter({ prisma: { department: { findUnique: lookup }, team: { create: write, update: write } } as any }));
    for (const method of ['post', 'patch'] as const) {
      const response = await request(app)[method]('/hr/teams' + (method === 'patch' ? '/local-team' : '')).set('Authorization', companyAuthorization).send({ name: 'Group', departmentId: 'foreign-dept' });
      expect(response.status).toBe(400);
    }
    expect(lookup).toHaveBeenCalledWith({ where: { id: 'foreign-dept', AND: [{}, { companyId: 'company-a' }] } });
    expect(write).not.toHaveBeenCalled();
  });
  it('sends the merged positions endpoints to 岗位与权限 without writing', async () => {
    const write = vi.fn();
    const app = express(); app.use(express.json());
    app.use('/hr', createHRRouter({ prisma: { jobPosition: { create: write, update: write, delete: write } } as any, requireAuth: false }));
    for (const [method, path] of [['post', '/hr/positions'], ['patch', '/hr/positions/p1'], ['delete', '/hr/positions/p1']] as const) {
      const response = await request(app)[method](path).send({ title: 'Test', departmentId: 'd1' });
      expect(response.status).toBe(410);
      expect(response.body.error).toBe('POSITIONS_MERGED');
    }
    expect(write).not.toHaveBeenCalled();
  });
});
