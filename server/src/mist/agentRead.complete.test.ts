import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createMistState} from '../shared/mistWorkspace';
import type {TokenPayload} from '../auth/service';
import {agentGet,agentQuery} from './agentRead';

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
