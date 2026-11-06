import { describe, expect, it, vi } from 'vitest';
import { bindSampleOrigins, cloneSampleOrigins, readSampleOriginContexts, sampleOriginFingerprint, sampleProjectionKey, snapshotSampleOrigin, loadSampleOriginCommand, loadSealSampleOriginCommand } from '../sampleOriginService';
import { fabricAuthorizationFixture } from '../../development/__tests__/fabricAuthorizationFixture';

const fabricCase = { id: 'C-F', type: 'fabric', customerRelationId: 'CUSTOMER', specComposition: 'cotton', deletedAt: null };
const garmentCase = { id: 'C-G', type: 'garment', customerRelationId: 'CUSTOMER', productAssetId: null, styleSpec: 'STYLE', deletedAt: null };
const fabric = (id='B-A', factory='A', round=1): any => ({ id, batchCode: id, developmentCaseId: 'C-F', supplierRelationId: factory,
  sampleType: 'yardage', round, status: 'pending', confirmStatus: 'unconfirmed', updatedAt: 10n, deletedAt: null, specNote: 'physical-v1', attachments: {} });
const sample = (id='S-A', sourceCaseId='C-F', supplierRelationId='A'): any => ({ id, code:id, type:'dev', sourceCaseId, sourceOrderId:null,
  productAssetId:null, supplierRelationId, projectionKey:null, deletedAt:null });
function fixture(seed: { cases?: any[]; batches?: any[]; samples?: any[]; seals?: any[]; links?: any[] } = {}) {
  const state = { cases: seed.cases ?? [fabricCase], batches:seed.batches ?? [fabric()], samples:seed.samples ?? [sample()], sources:[] as any[], audits:[] as any[], seals:seed.seals ?? [], links:seed.links ?? [] };
  const matches=(row:any,where:any):boolean=>!where||Object.entries(where).every(([key,value]:any)=> key==='OR'?value.some((part:any)=>matches(row,part)):value&&typeof value==='object'&&'in'in value?value.in.includes(row[key]):row[key]===value);
  const delegate=(rows:()=>any[])=>({findMany:vi.fn(async({where}:any={})=>rows().filter(row=>matches(row,where))),findFirst:vi.fn(async({where}:any)=>rows().find(row=>matches(row,where))??null)});
  const tx:any={ ...fabricAuthorizationFixture('ACTOR'), developmentLifecycleEvent:{findFirst:vi.fn(async()=>null)},
    $queryRaw:vi.fn(async()=>[{id:'locked'}]), developmentCase:delegate(()=>state.cases),
    sampleBatch:{...delegate(()=>state.batches),update:vi.fn(async({where,data}:any)=>{const row=state.batches.find(b=>b.id===where.id);Object.assign(row,data);return {...row};}),updateMany:vi.fn(async()=>({count:0}))},
    sealSample:delegate(()=>state.seals),sealSampleBatch:delegate(()=>state.links),productAsset:delegate(()=>[]),
    sample:{...delegate(()=>state.samples),findUnique:vi.fn(async({where}:any)=>state.samples.find(row=>matches(row,where))??null),
      create:vi.fn(async({data}:any)=>{const row={...data,deletedAt:null};state.samples.push(row);return row;}),update:vi.fn(async({where,data}:any)=>{const row=state.samples.find(s=>s.id===where.id);Object.assign(row,data);return row;})},
    sampleSource:{...delegate(()=>state.sources),create:vi.fn(async({data}:any)=>{state.sources.push(data);return data;})},
    auditLog:{...delegate(()=>state.audits),create:vi.fn(async({data}:any)=>{state.audits.push({...data,createdAt:new Date()});return data;})},
    businessSequence:{upsert:vi.fn(async()=>({seq:0})),update:vi.fn(async()=>({seq:state.samples.length+1}))},
  };
  const prisma:any={...tx,$transaction:async(fn:any)=>{const before=structuredClone(state);try{return await fn(tx);}catch(error){Object.assign(state,before);throw error;}}};
  return {tx,prisma,state};
}
async function bind(f:any,s= f.state.samples[0],b=f.state.batches[0],c=f.state.cases[0],options:any={}) {
  await bindSampleOrigins(f.tx,s,[snapshotSampleOrigin(b,c)],'ACTOR',options);
}
describe('Sample exact physical origin',()=>{
  it('binds server batch/round/content with mandatory audit; same origin metadata replay creates no second binding',async()=>{
    const f=fixture();await bind(f);const original=f.state.sources[0];f.state.batches[0].updatedAt=99n;
    await bind(f);expect(f.state.sources).toHaveLength(1);expect(f.state.audits).toHaveLength(1);expect(f.state.sources[0]).toEqual(original);
    const [context]=await readSampleOriginContexts(f.tx,f.state.samples);expect(context.status).toBe('resolved');expect(context.currentUsable).toBe(false);
  });
  it('new native round has a new stable key, whereas status/updatedAt do not participate',()=>{
    expect(sampleProjectionKey('garment_pp','ROUND-A',1)).toBe('v1:garment_pp:ROUND-A:1');
    expect(sampleProjectionKey('garment_pp','ROUND-A',2)).not.toBe(sampleProjectionKey('garment_pp','ROUND-A',1));
    const b=fabric();const first=sampleOriginFingerprint(snapshotSampleOrigin(b,fabricCase));b.status='approved';b.updatedAt=80n;
    expect(sampleOriginFingerprint(snapshotSampleOrigin(b,fabricCase))).toBe(first);
  });
  it.each(['specNote','dyeLotNo','photos'])('same origin content change %s is refused without new relation/audit',async field=>{
    const f=fixture();await bind(f);f.state.batches[0][field]=field==='photos'?['changed']:'changed';
    await expect(bind(f)).rejects.toMatchObject({code:'DEVELOPMENT_SOURCE_CHANGED'});expect(f.state.sources).toHaveLength(1);expect(f.state.audits).toHaveLength(1);
  });
  it('changed case material specification invalidates current use while preserving frozen identity',async()=>{
    const f=fixture();await bind(f);f.state.cases[0]={...fabricCase,specComposition:'polyester'};
    const [context]=await readSampleOriginContexts(f.tx,f.state.samples);expect(context.status).toBe('resolved');expect(context.reasons).toContain('ORIGIN_CONTENT_CHANGED');expect(context.currentUsable).toBe(false);
  });
  it('malformed current native history remains explicit invalid evidence instead of breaking historical reads',async()=>{
    const f=fixture();await bind(f);f.state.batches[0].attachments={fabricHistory:{schemaVersion:99,revision:1,events:'corrupt'}};
    const [context]=await readSampleOriginContexts(f.tx,f.state.samples);expect(context.status).toBe('resolved');expect(context.currentUsable).toBe(false);
    expect(context.reasons).toContain('ORIGIN_PARENT_INVALID');expect(context.reasons).toContain('ORIGIN_NATIVE_APPROVAL_EVIDENCE_INVALID');
  });
  it('same-case/factory/name lookalikes do not establish exact origin',async()=>{
    const f=fixture({samples:[sample('LEGACY')]});const [context]=await readSampleOriginContexts(f.tx,f.state.samples);
    expect(context.status).toBe('unresolved');expect(context.reasons).toEqual(['NO_EXACT_ORIGIN']);
  });
  it('binding audit failure rolls back source and sample writes in a stateful transaction simulation',async()=>{
    const f=fixture();f.tx.auditLog.create.mockRejectedValueOnce(Error('audit unavailable'));
    await expect(f.prisma.$transaction(async(tx:any)=>{await tx.sample.create({data:sample('NEW')});await bindSampleOrigins(tx,sample('NEW'),[snapshotSampleOrigin(f.state.batches[0],fabricCase)],'ACTOR');})).rejects.toThrow('audit unavailable');
    expect(f.state.samples).toHaveLength(1);expect(f.state.sources).toHaveLength(0);expect(f.state.audits).toHaveLength(0);
  });
  it('missing binding audit or corrupted fingerprint is a conflict',async()=>{
    const f=fixture();await bind(f);f.state.audits=[];
    expect((await readSampleOriginContexts(f.tx,f.state.samples))[0].status).toBe('conflict');f.state.sources[0].sourceFingerprint='fabricated';
    expect((await readSampleOriginContexts(f.tx,f.state.samples))[0].reasons).toContain('ORIGIN_SNAPSHOT_INVALID');
  });
  it('unknown legacy cut/fork ancestry stays unknown without manufactured approval or source',async()=>{
    const f=fixture({samples:[sample('P'),sample('CHILD')]});await cloneSampleOrigins(f.tx,'P','CHILD','ACTOR');
    expect(f.state.sources).toHaveLength(0);expect(f.state.audits).toHaveLength(0);
  });
  it('unapproved and superseded physical samples can retain valid inherited identity without canonical approval',async()=>{
    const f=fixture({samples:[sample('P'),sample('CHILD')]});await bind(f,f.state.samples[0]);f.state.batches[0].round=2;
    await cloneSampleOrigins(f.tx,'P','CHILD','ACTOR');const child=(await readSampleOriginContexts(f.tx,[f.state.samples[1]]))[0];
    expect(child.status).toBe('resolved');expect(child.currentUsable).toBe(false);expect(child.originKind).toBe('inherited');expect(child.projectionKey).toBe(null);expect(child.origins[0].sourceRound).toBe(1);
    expect(f.state.audits[1].detail.after.nativeApprovalInherited).toBe(false);
  });
  it('deleted source or different child factory refuses inheritance',async()=>{
    const f=fixture({samples:[sample('P'),sample('CHILD','C-F','B')]});await bind(f,f.state.samples[0]);
    await expect(cloneSampleOrigins(f.tx,'P','CHILD','ACTOR')).rejects.toMatchObject({code:'DEVELOPMENT_SOURCE_CHANGED'});
    f.state.samples[1].supplierRelationId='A';f.state.batches[0].deletedAt=1n;
    await expect(cloneSampleOrigins(f.tx,'P','CHILD','ACTOR')).rejects.toMatchObject({code:'DEVELOPMENT_SOURCE_CHANGED'});expect(f.state.sources).toHaveLength(1);
  });
  it('a descendant cannot copy a canonical projection key',async()=>{
    const f=fixture({samples:[sample('P'),{...sample('CHILD'),projectionKey:'v1:garment_pp:ROUND-A:1'}]});await bind(f,f.state.samples[0]);
    await expect(cloneSampleOrigins(f.tx,'P','CHILD','ACTOR')).rejects.toMatchObject({code:'DEVELOPMENT_SOURCE_CHANGED'});
  });
  it.each([{sourceRound:2},{expectedUpdatedAt:'11'},{batchId:'MISSING'}])('explicit source command rejects stale/missing identity %j',async override=>{
    const f=fixture();await expect(loadSampleOriginCommand(f.tx,'C-F',{batchId:'B-A',sourceRound:1,expectedUpdatedAt:'10',...override})).rejects.toMatchObject({code:'DEVELOPMENT_SOURCE_CHANGED'});
    expect(f.state.sources).toHaveLength(0);expect(f.state.audits).toHaveLength(0);
  });
  it('label-only legacy approved source never proves native approval/version for new exact origin',async()=>{
    const f=fixture();f.state.batches[0]= {...fabric(),status:'approved',approvedAt:1n,approvedBy:'ACTOR'};await bind(f);
    const [context]=await readSampleOriginContexts(f.tx,f.state.samples);expect(context.status).toBe('resolved');expect(context.currentUsable).toBe(false);expect(context.reasons).toContain('ORIGIN_APPROVAL_VERSION_UNPROVEN');
  });
  it('explicit composite source refuses missing component or another factory',async()=>{
    const seal={id:'SEAL',developmentCaseId:'C-F',supplierRelationId:'A',status:'sealed',updatedAt:20n,deletedAt:null};
    const f=fixture({batches:[fabric('A1'),fabric('A2','B')],seals:[seal],links:[{sealSampleId:'SEAL',sampleBatchId:'A1'},{sealSampleId:'SEAL',sampleBatchId:'A2'}]});
    await expect(loadSealSampleOriginCommand(f.tx,'C-F',{sealId:'SEAL',expectedUpdatedAt:'20',components:[{batchId:'A1',sourceRound:1,expectedUpdatedAt:'10'}]})).rejects.toMatchObject({code:'DEVELOPMENT_SOURCE_CHANGED'});
    await expect(loadSealSampleOriginCommand(f.tx,'C-F',{sealId:'SEAL',expectedUpdatedAt:'20',components:f.state.batches.map(b=>({batchId:b.id,sourceRound:1,expectedUpdatedAt:'10'}))})).rejects.toMatchObject({code:'DEVELOPMENT_SOURCE_CHANGED'});expect(f.state.sources).toHaveLength(0);
  });
});
