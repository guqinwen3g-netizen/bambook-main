import { beforeEach, expect, it, vi } from 'vitest';
const source = vi.hoisted(() => ({ load: vi.fn(), build: vi.fn() }));
vi.mock('../auth/tokenHelpers', () => ({ loadUserWithRoles: source.load, buildLoadedAuthTokenPayload: source.build }));
import { freshMistAuthority } from './authority';
import { testActor } from './__tests__/support';
import {createAgentDelegation} from './agentDelegation';
import {randomUUID} from 'node:crypto';
import {MemoryMistDatabase} from './__tests__/support';
import {createIdentity,issueServiceKey,resolveServiceCredential} from './agentIdentities';
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
it('revalidates a long service key against the owners current grants and original password generation',async()=>{
 const db=new MemoryMistDatabase(),workspaceId=randomUUID(),id=randomUUID(),now=Date.now();
 const owner={...testActor(),roles:[],permissions:['ai:chat','products:read'],authorizationLoaded:true,credentialVersion:'before'};
 const d=createAgentDelegation({rootSecret:()=> 'service-authority-test',resolve:()=>({...owner,credentialVersion:'after',permissions:['*']})});
 await db.$transaction(tx=>createIdentity(tx,{...testActor('manager'),permissions:['users:write']},workspaceId,{id,name:'Read products',ownerId:'owner',mode:'operate'},{id:'owner',name:'Owner'},now));
 const issued=await db.$transaction(tx=>issueServiceKey(tx,owner,workspaceId,id,{requestId:randomUUID(),version:1},d.makeServiceCredential,now));
 const actor=await d.hydrateServiceActor(await db.$transaction(tx=>resolveServiceCredential(tx,issued.token)));
 expect(actor.credentialVersion).toBe('before');expect(actor.iat).toBe(Math.floor(now/1000));
 source.load.mockResolvedValue({id:'owner',status:'active',deletedAt:null,metadata:{credentialVersion:'before'}});
 source.build.mockResolvedValue({...testActor(),roles:[],permissions:['ai:chat','products:read','finance:write'],authorizationLoaded:true});
 await expect(freshMistAuthority({},actor,'products:read')).resolves.toMatchObject({permissionCeiling:expect.arrayContaining(['products:read'])});
 await expect(freshMistAuthority({},actor,'finance:write')).rejects.toMatchObject({status:403});
 source.build.mockResolvedValue({...testActor(),roles:[],permissions:['ai:chat'],authorizationLoaded:true});
 await expect(freshMistAuthority({},actor,'products:read')).rejects.toMatchObject({status:403});
 source.load.mockResolvedValue({id:'owner',status:'active',deletedAt:null,metadata:{credentialVersion:'after'}});
 await expect(freshMistAuthority({},actor)).rejects.toMatchObject({status:401});
});
