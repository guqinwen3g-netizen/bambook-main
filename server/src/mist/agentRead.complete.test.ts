import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {applyMistCommand,createMistState,type DevelopmentValues} from '../shared/mistWorkspace';
import {withTestFactories} from '../shared/__tests__/utils/devFactories';
import type {TokenPayload} from '../auth/service';
import {agentGet,agentQuery} from './agentRead';
import {collectTaskSources,taskReadHash} from './agentTaskVisibility';

const actor={userId:'owner',permissions:['emails:read','orders:read'],roles:[],departmentIds:[],authorizationLoaded:true} as TokenPayload;
const state=()=>createMistState({id:randomUUID,actorName:'Test',now:'2026-11-01T00:00:00Z'},'empty');
it('identifies the RFQ section in a supplier inquiry return link',()=>{
 const s=state();s.rfqs=[{id:'rfq-return',code:'RFQ-RETURN'} as any];const result=agentGet(s,{...actor,permissions:['procurement:read']},'rfq','rfq-return'),url=new URL(result.link!);
 expect(url.searchParams.get('view')).toBe('procurement');expect(url.searchParams.get('section')).toBe('rfq');expect(url.searchParams.get('id')).toBe('rfq-return');
});
it('returns a small deep review record in full rather than dropping it at an arbitrary nesting depth',()=>{
 const s=state(),mail={id:'mail',subject:'Production request',body:'Original message',submissions:[{items:[{source:{review:{details:[{result:'accepted',note:'Complete original fact'}]}}}]}]};s.email.messages.push(mail as any);
 const result=agentGet(s,actor,'email','mail');expect(result.truncated).toBe(false);expect(result.data).toEqual(mail);
});
it('retains every item and a longer body when the full business record still fits the response budget',()=>{
 const s=state(),mail={id:'mail',subject:'Order notes',body:'x'.repeat(11000),links:Array.from({length:40},(_,i)=>({kind:'order',id:'order-'+i}))};s.email.messages.push(mail as any);
 const result=agentGet(s,actor,'email','mail');expect(result.truncated).toBe(false);expect(result.data.body).toHaveLength(11000);expect(result.data.links).toHaveLength(40);expect(JSON.stringify(result).length).toBeLessThan(20000);
});
it('keeps the hard budget and explicit incompleteness for a record that does not fit',()=>{
 const s=state();s.orders.push({id:'order',code:'SO-1',note:'x'.repeat(30000)} as any);const result=agentGet(s,actor,'order','order');expect(result.truncated).toBe(true);expect(JSON.stringify(result).length).toBeLessThan(20000);expect(result.readHint).toContain('不完整');
});
it('does not expose embedded image bytes or revive internal mail send request and transport fields',()=>{
 const s=state();s.orders.push({id:'order',code:'SO-1',img:'data:image/png;base64,private-image',detail:{img:'private-nested-image',name:'Visible'}} as any);expect(JSON.stringify(agentGet(s,actor,'order','order'))).not.toContain('private-');
 s.email.sends.push({id:'send',subject:'Order',from:'staff@example.test',to:'buyer@example.test',body:'Text',status:'sent',requestId:'private-key',response:'private-transport'} as any);expect(JSON.stringify(agentGet(s,actor,'email_send','send'))).not.toContain('private-');
});
it('still gates the entire record with the caller current type permission',()=>{
 const s=state();s.orders.push({id:'order',code:'SO-1',detail:{nested:{secret:'not allowed'}}} as any);expect(()=>agentGet(s,{...actor,permissionCeiling:[]},'order','order')).toThrow('无权读取');
});

it('returns to the exact development version or order line rather than the current version',()=>{
 const s=state();s.versions.push({id:'old-version',devId:'development'} as any);s.orderLines.push({id:'line-2',orderId:'order'} as any);
 expect(agentGet(s,{...actor,permissions:['products:read','orders:read']},'dev_version','old-version').link).toContain('versionId=old-version');
 expect(agentGet(s,actor,'order_line','line-2').link).toContain('orderLineId=line-2');
});
it('finds a development draft by its business fields and reads the exact draft with attachment references',()=>{
 const s=state();s.drafts.push({id:'draft',values:{name:'羊毛大衣',style:'NW-31',customer:'Northwind',fabric:'80% wool'},fileIds:['source'],updatedAt:'2026-11-11',ownerId:'sales'} as any);s.files.push({id:'source',name:'RFQ.docx',mimeType:'application/octet-stream',size:100} as any);
 const permitted={...actor,permissions:['products:read']};
 expect(agentQuery(s,permitted,{type:'development_draft',q:'NW-31'}).results.map(r=>r.id)).toEqual(['draft']);
 expect(agentQuery(s,permitted,{type:'development_draft',q:'draft'}).results.map(r=>r.id)).toEqual(['draft']);
 const result=agentGet(s,permitted,'development_draft','draft');expect(result.link).toContain('view=development%2Fnew');expect(result.link).toContain('id=draft');expect(result.data).toEqual(s.drafts[0]);expect(result.label).toBe('羊毛大衣');expect(result.attachments?.[0].fileId).toBe('source');
 expect(()=>agentGet(s,{...actor,permissionCeiling:[]},'development_draft','draft')).toThrow('无权读取');
});

function legacyClosedDevelopment(){
 let next=0;const context={id:()=>`read-reopen-${++next}`,actorId:'owner',actorName:'原业务',now:'2026-11-18T04:00:00.000Z'};let s=withTestFactories(createMistState(context,'empty'));
 s.customers.push({id:'client',name:'客户',code:'C',country:'',city:'',industry:'',owner:'',grade:'',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
 const values:DevelopmentValues={name:'外套',customer:'client',style:'ST-1',season:'AW',category:'外套',kind:'new',fabric:'羊毛',color:'灰',target:'',sizeBase:'M',goal:'版型',factories:['A厂'],due:'2026-11-21',collaborators:[],sampleQuantity:1};
 const submitted=applyMistCommand(s,{type:'development.submit',payload:{values,fileIds:[]}},context),created=submitted.result as any;s=submitted.state;
 s=applyMistCommand(s,{type:'development.close',payload:{devId:created.devId,kind:'cancelled',reason:'客户暂缓'}},context).state;
 const dev=s.devs.find(d=>d.id===created.devId)!,event=s.events[0];delete dev.closure!.id;delete event.developmentLifecycle;
 return{s,dev,event,context,permitted:{...actor,permissions:['products:read']} as TokenPayload};
}
it('exposes a unique legacy closure source outside development data so the machine can use its exact reopen token',()=>{
 const {s,dev,event,context,permitted}=legacyClosedDevelopment(),before=structuredClone(s),result=agentGet(s,permitted,'development',dev.id);
 expect((result as any).reopenSource).toEqual({closureId:event.id,expectedVersionId:dev.currentVersionId});
 const {img:_image,...visible}=dev;expect(result.data).toEqual(visible);expect(result.data).not.toHaveProperty('reopenSource');expect(s).toEqual(before);expect(dev.closure!.id).toBeUndefined();
 const tracked=collectTaskSources({workspace:{revision:12},object:result},s,[]).find(ref=>ref.path==='devs'&&ref.id===dev.id);
 expect(tracked?.fullReadHash).toBe(taskReadHash(visible));
 expect(agentQuery(s,permitted,{type:'development',q:dev.code}).results[0].summary).not.toHaveProperty('reopenSource');
 const source=(result as any).reopenSource,reopened=applyMistCommand(s,{type:'development.reopen',payload:{devId:dev.id,...source,reason:'继续开发'}},context).state;
 expect(reopened.devs.find(item=>item.id===dev.id)!.closure).toBeUndefined();expect(reopened.events.find(item=>item.id===event.id)).toEqual(before.events[0]);
});
it('keeps exact closure identifiers outside compacted data without exceeding the original data-plus-metadata budget',()=>{
 const {s,dev,event,permitted}=legacyClosedDevelopment();dev.values.goal='x'.repeat(25000);const before=structuredClone(s),result=agentGet(s,permitted,'development',dev.id);
 expect(result.truncated).toBe(true);expect((result as any).reopenSource).toEqual({closureId:event.id,expectedVersionId:dev.currentVersionId});
 expect(JSON.stringify({data:result.data,reopenSource:(result as any).reopenSource}).length).toBeLessThanOrEqual(16000);expect(s).toEqual(before);
});
it.each(['missing','ambiguous','another development'] as const)('does not invent a legacy reopen token from %s events',kind=>{
 const {s,dev,event,permitted}=legacyClosedDevelopment();if(kind==='missing')s.events=[];if(kind==='ambiguous')s.events.push({...structuredClone(event),id:'second-event'});if(kind==='another development')event.entityId='hidden-development';
 expect((agentGet(s,permitted,'development',dev.id) as any).reopenSource).toBeNull();
});
it('uses the trusted new closure ID directly and does not make events readable as another object type',()=>{
 const {s,dev,permitted}=legacyClosedDevelopment();dev.closure!.id='new-server-closure';s.events=[];
 expect((agentGet(s,permitted,'development',dev.id) as any).reopenSource).toEqual({closureId:'new-server-closure',expectedVersionId:dev.currentVersionId});
 expect(()=>agentGet(s,permitted,'event','event-id')).toThrow('不支持的对象类型');
});
it('does not derive metadata for an invisible development or a caller without current read authority',()=>{
 const {s,dev,permitted}=legacyClosedDevelopment();expect(()=>agentGet(s,{...permitted,permissionCeiling:[]},'development',dev.id)).toThrow('无权读取');
 s.devs=[];expect(()=>agentGet(s,permitted,'development',dev.id)).toThrow('不可见');
});
it('does not reuse a past token for an open development or truncate an oversized identity into another token',()=>{
 const {s,dev,permitted}=legacyClosedDevelopment();const closure=dev.closure;delete dev.closure;
 expect(agentGet(s,permitted,'development',dev.id).reopenSource).toBeNull();dev.closure={...closure!,id:'x'.repeat(201)};
 expect(agentGet(s,permitted,'development',dev.id).reopenSource).toBeNull();
});
