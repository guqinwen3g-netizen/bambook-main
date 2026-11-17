import {expect,it} from 'vitest';
import {projectState,canReadFile} from './access';
import {createMistState} from '../shared/mistWorkspace';
import {developmentReferenceFixture} from '../shared/__tests__/utils/developmentReferences';
const actor:any={userId:'sales',displayName:'业务员',roles:[],departmentIds:[],authorizationLoaded:true,permissions:['products:read','products:write','suppliers:read','relations:read']};
const empty=()=>createMistState({id:()=>'',now:'2026-11-18T04:00:00Z',actorName:'业务员'},'empty');
const scope={userIds:['sales'],teamIds:[]};
it('hides an inaccessible sample identity/specification/original from a visible case and does not grant its file through the reference snapshot',()=>{
 const f=developmentReferenceFixture();f.sample().registeredById='another';f.link();const raw=structuredClone(f.state);
 const visible=projectState(f.state,actor,empty,'admin',scope).state;expect(visible.devs.some(d=>d.id===f.devId)).toBe(true);expect(visible.fulfillment.samples).toEqual([]);
 expect(visible.devs.find(d=>d.id===f.devId)?.sampleReferences||[]).toEqual([]);expect(visible.files.some(file=>file.id==='reference-original')).toBe(false);expect(canReadFile(f.state,actor,'reference-original',empty,'admin',scope)).toBe(false);
 expect(f.state).toEqual(raw);
});
it('keeps the trusted history raw but cannot use a past reference attachment to restore access after it is removed from the currently visible sample',()=>{
 const f=developmentReferenceFixture();f.link();f.sample().fileIds=[];
 const visible=projectState(f.state,actor,empty,'admin',scope).state;
 expect(visible.devs.find(d=>d.id===f.devId)?.sampleReferences?.[0].snapshots[0].facts.fileIds).toEqual([]);
 expect(visible.files.some(file=>file.id==='reference-original')).toBe(false);expect(canReadFile(f.state,actor,'reference-original',empty,'admin',scope)).toBe(false);
 expect(f.state.devs.find(d=>d.id===f.devId)?.sampleReferences?.[0].snapshots[0].facts.fileIds).toEqual(['reference-original']);
});
it('never grants another manual record or upstream source merely because an accessible case references one sample',()=>{
 const f=developmentReferenceFixture();f.sample().registeredById='another';f.link();const clone=structuredClone(f.sample());clone.id='another-sample';clone.code='SMP-OTHER';f.state.fulfillment.samples.push(clone);
 const visible=projectState(f.state,actor,empty,'admin',scope).state;expect(visible.fulfillment.samples).toEqual([]);expect(visible.versions).toHaveLength(1);expect(visible.devs).toHaveLength(1);
});
