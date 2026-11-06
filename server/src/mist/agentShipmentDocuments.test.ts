import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createMistState,applyMistCommand,mistCommandPermission} from '../shared/mistWorkspace';
import {SYSTEM_ROLE_IDS} from '../_shared/rolePermissionMatrix';
import {MemoryMistDatabase,testAuthority} from './__tests__/support';import {MistRepository} from './repository';import {MistPrivateFiles} from './files';
import {agentCatalog,agentGet,agentQuery} from './agentRead';
let directory:string,db:MemoryMistDatabase,repo:MistRepository,auth:ReturnType<typeof testAuthority>,workspaceId:string;
const company='11111111-1111-4111-8111-111111111111',now='2026-11-07T00:06:00Z';
const actorWith=(role:string):any=>({userId:'clerk',displayName:'Clerk',roleIds:[role+'@'+company],roles:[],companyId:company,authorizationLoaded:true});
const document=(id:string)=>({id,shipmentId:'ship-1',orderId:'order-1',type:'CI',number:'CI-'+id,version:1,title:'Commercial invoice',dueDate:'2026-11-20',content:'x'.repeat(5000),fileIds:['file-upload'],status:'issued',createdAt:now,issuedAt:now,actor:'Clerk',invoiceId:'inv-1',
 generated:[{id:'gen-1',kind:'CI',number:'CI-'+id,fileId:'file-pdf',fileName:'ci.pdf',sha256:'abc',bytes:1234,templateVersion:1,snapshotFingerprint:'fp',snapshot:{secret:'snapshot-sentinel'},generatedAt:now,generatedBy:'Clerk',sealUseId:'seal-1'}],
 externalIssue:{issuer:'Carrier',at:now,evidence:'evidence-sentinel',recordedBy:'Clerk'}});
beforeEach(async()=>{
 vi.spyOn(Date,'now').mockReturnValue(Date.parse(now));directory=await mkdtemp(path.join(tmpdir(),'mist-agent-docs-'));db=new MemoryMistDatabase();auth=testAuthority();auth.users.set('clerk',{active:true,permissions:['ai:chat','customs:read']});db.companyMembers.push({companyId:company,userId:'clerk',status:'active'});
 const state=createMistState({id:randomUUID,now,actorId:'clerk',actorName:'Clerk'},'empty');(state.fulfillment as any).documents=[document('d1')];
 workspaceId=randomUUID();db.workspaces.set(workspaceId,{id:workspaceId,ownerId:'other',companyId:company,slug:'company@'+company,name:'Company',revision:4,state,createdAt:new Date(),updatedAt:new Date()});repo=new MistRepository(db,{createMistState,applyMistCommand,mistCommandPermission},new MistPrivateFiles(directory),auth.authorize);
});
afterEach(async()=>{vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});});
async function view(role:string=SYSTEM_ROLE_IDS.LOGISTICS){const{workspace,actor:current}=await repo.getForAgent(actorWith(role),workspaceId);return{state:workspace.state,actor:current};}
it('lets an agent read shipment document facts and file ids without generated snapshots or evidence text',async()=>{
 const f=await view();expect(agentCatalog(f.actor).map(t=>t.type)).toContain('shipment_document');
 const record=agentGet(f.state,f.actor,'shipment_document','d1');
 expect(record.data).toMatchObject({type:'CI',status:'issued',number:'CI-d1',fileIds:['file-upload'],generated:[{fileId:'file-pdf',sha256:'abc',bytes:1234,sealed:true}],contentTruncated:true});
 const text=JSON.stringify(record);expect(text).not.toContain('snapshot-sentinel');expect(text).not.toContain('evidence-sentinel');
 expect((record.data as any).content).toHaveLength(2000);expect(record.link).toContain('id=ship-1');
});
it('lists documents for a reader and refuses accounts without customs read access',async()=>{
 let f=await view();expect(agentQuery(f.state,f.actor,{type:'shipment_document'}).results.map((i:any)=>i.id)).toEqual(['d1']);
 auth.users.get('clerk')!.permissions=['ai:chat'];f=await view(SYSTEM_ROLE_IDS.SALES);
 expect(agentCatalog(f.actor).map(t=>t.type)).not.toContain('shipment_document');
 expect(()=>agentGet(f.state,f.actor,'shipment_document','d1')).toThrow();expect(()=>agentQuery(f.state,f.actor,{type:'shipment_document'})).toThrow();
});
it('flattens generated quotation and order files into metadata-only objects with their parent read scope',async()=>{
 const raw=db.workspaces.get(workspaceId).state;
 raw.market.quotations=[{id:'q1',code:'QT-1',ownerId:'clerk',documents:[{id:'qd1',quotationId:'q1',revision:2,draft:false,fileId:'f-q',fileName:'q.pdf',sha256:'h1',bytes:10,templateVersion:1,snapshotFingerprint:'fp',snapshot:{price:'quote-snapshot-sentinel'},generatedAt:now,generatedBy:'Clerk',generatedById:'clerk'}]}];
 raw.orders=[{id:'o1',code:'SO-1',ownerId:'clerk',documents:[{id:'od1',orderKind:'PI',version:3,kind:'PI',number:'PI-1',fileId:'f-o',fileName:'o.pdf',sha256:'h2',bytes:20,templateVersion:1,snapshotFingerprint:'fp',snapshot:{terms:'order-snapshot-sentinel'},generatedAt:now,generatedBy:'Clerk'}]}];
 auth.users.get('clerk')!.permissions=['ai:chat','quotations:read','orders:read'];const f=await view(SYSTEM_ROLE_IDS.SUPER_ADMIN);
 const q=agentGet(f.state,f.actor,'quotation_document','qd1'),o=agentGet(f.state,f.actor,'order_document','od1');
 expect(q.data).toMatchObject({quotationId:'q1',revision:2,fileId:'f-q',sha256:'h1',draft:false});expect(o.data).toMatchObject({orderId:'o1',kind:'PI',version:3,fileId:'f-o'});
 const text=JSON.stringify([q,o]);expect(text).not.toContain('snapshot-sentinel');expect(q.link).toContain('id=q1');expect(o.link).toContain('id=o1');
 auth.users.get('clerk')!.permissions=['ai:chat'];const g=await view(SYSTEM_ROLE_IDS.SALES);
 expect(()=>agentGet(g.state,g.actor,'order_document','od1')).toThrow();
});
