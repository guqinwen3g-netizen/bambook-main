import { beforeEach, expect, it, vi } from 'vitest';
const source = vi.hoisted(() => ({ load: vi.fn(), build: vi.fn() }));
vi.mock('../auth/tokenHelpers', () => ({ loadUserWithRoles: source.load, buildLoadedAuthTokenPayload: source.build }));
import { freshMistAuthority } from './authority';
import { testActor } from './__tests__/support';
import {createAgentDelegation} from './agentDelegation';
import {randomUUID} from 'node:crypto';
beforeEach(() => { vi.clearAllMocks(); source.load.mockResolvedValue({ id: 'owner', status: 'active', deletedAt: null }); source.build.mockResolvedValue({ ...testActor(), authorizationLoaded: true }); });
it('loads current account grants rather than trusting the signed snapshot and retains its ceiling', async () => {
  const db = {}, token = { ...testActor(), permissions: ['*'], permissionCeiling: ['products:write'] };
  await expect(freshMistAuthority(db, token, 'finance:write')).rejects.toMatchObject({ status: 403 });
  const current = await freshMistAuthority(db, token, 'products:write'); expect(current.permissionCeiling).toEqual(['products:write']); expect(source.load).toHaveBeenCalledWith(db, 'owner');
});
it('rejects deleted or disabled accounts even when the credential had wildcard permissions', async () => {
  source.load.mockResolvedValue({ id: 'owner', status: 'disabled', deletedAt: null });
  await expect(freshMistAuthority({}, { ...testActor(), permissions: ['*'] })).rejects.toMatchObject({ status: 401 }); expect(source.build).not.toHaveBeenCalled();
});
it('carries the original credential version and issue time into fresh authority, so password/logout revocation applies',async()=>{
 const d=createAgentDelegation({rootSecret:()=> 'authority-test-secret',resolve:()=>testActor()});
 source.load.mockResolvedValue({id:'owner',status:'active',deletedAt:null,metadata:{credentialVersion:'before'}});
 const token=d.signManaged(d.prepareManaged({...testActor(),credentialVersion:'before'},randomUUID(),randomUUID(),'read')).token;
 await d.authenticate(token,async actor=>{expect(actor.credentialVersion).toBe('before');expect(typeof(actor as any).iat).toBe('number');await freshMistAuthority({},actor);});
 source.load.mockResolvedValue({id:'owner',status:'active',deletedAt:null,metadata:{credentialVersion:'after'}});
 await expect(d.authenticate(token,actor=>freshMistAuthority({},actor).then(()=>undefined))).rejects.toMatchObject({status:401});
 await expect(d.authenticate(token)).rejects.toMatchObject({status:503});
});
