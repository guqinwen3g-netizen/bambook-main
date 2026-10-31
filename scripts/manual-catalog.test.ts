import {afterEach, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {readLessonCatalog, publicManualCatalog, requireTrackedLessonSources} from './manual-catalog.mjs';

const roots:string[]=[];
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'manual-catalog-'));roots.push(root);
  const wiki=path.join(root,'wiki'),asset=path.join(wiki,'assets/lessons/first');fs.mkdirSync(asset,{recursive:true});fs.mkdirSync(path.join(wiki,'lessons'));
  const lesson={id:'first',title:'提交结算',order:1,role:'业务员',handoff:'财务',prerequisite:'实收已登记',entry:'财务管理',capture:'first',steps:[{title:'选择合同',do:'选择来源',see:'显示实收'}],doneTitle:'已提交',result:'等待复核',chain:['业务','财务'],sop:[{title:'核对实收',text:'按实际接收数量提交'}]};
  const capture={viewport:{width:100,height:80},frames:[{image:'01.webp',target:{x:10,y:10,width:20,height:10}}],result:'result.webp'};
  const write=()=>{fs.writeFileSync(path.join(wiki,'lessons/first.json'),JSON.stringify(lesson));fs.writeFileSync(path.join(asset,'capture.json'),JSON.stringify(capture));};
  write();for(const name of ['01.webp','result.webp'])fs.writeFileSync(path.join(asset,name),'fixture-image');
  return {root,wiki,asset,lesson,capture,write,read:()=>readLessonCatalog({rootDir:root,wikiDir:wiki,git:false})};
}
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

it('counts guided courses independently and never invents capture or acceptance metadata',()=>{
  const f=fixture(),c=f.read();expect(c.issues).toEqual([]);expect(c.totals).toEqual({lessons:1,steps:1,images:2});
  expect(c.tracks).toEqual([{name:'采购结算与付款',lessons:1,steps:1,images:2}]);
  expect(c.lessons[0].provenance).toEqual({status:'unknown',softwareCommit:null,capturedAt:null});
  expect(c.verification.playback.unknown).toBe(1);expect(c.verification.employee.unknown).toBe(1);
  const published=JSON.stringify(publicManualCatalog(c,{commit:'f'.repeat(40),privatePath:f.root}));expect(published).not.toContain(f.root);expect(published).not.toContain('imageFiles');
});

it('detects missing media, a frame mismatch, off-screen targets and broken next-course references',()=>{
  const f=fixture();fs.unlinkSync(path.join(f.asset,'result.webp'));
  f.capture.frames[0].target.x=99;f.lesson.steps.push({...f.lesson.steps[0]});Object.assign(f.lesson,{nextLesson:{id:'missing',title:'下一课'}});f.write();
  const c=f.read();expect(c.issues.map(i=>i.code)).toEqual(expect.arrayContaining(['IMAGE_MISSING','TARGET','FRAME_COUNT','NEXT_MISSING']));expect(c.totals.images).toBe(1);
});

it('reports malformed teaching help, quiz and typed values without crashing the checker',()=>{
 const f=fixture();Object.assign(f.lesson.steps[0],{fill:42,failure:{title:'失败'},quiz:{question:'怎么处理？',options:[null,{label:'选项',correct:true,reply:'说明'}]}});Object.assign(f.lesson,{chainAt:10});Object.assign(f.capture.frames[0],{value:{secret:'not text'}});f.write();
 expect(f.read().issues.map(i=>i.code)).toEqual(expect.arrayContaining(['STEP_HELP','QUIZ_SHAPE','HANDOFF_POSITION','FRAME_VALUE']));
});

it('keeps an uncommitted or ignored local image out of a formal teaching build',()=>{
 const f=fixture();const git=(...args:string[])=>execFileSync('git',args,{cwd:f.root,stdio:'pipe'});
 git('init','-q');git('add','wiki/lessons','wiki/assets/lessons/first/capture.json','wiki/assets/lessons/first/01.webp');
 git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','teaching source','--no-verify');
 const read=()=>readLessonCatalog({rootDir:f.root,wikiDir:f.wiki});expect(read().issues).toEqual([]);expect(()=>requireTrackedLessonSources(read())).toThrow('纳入Git');
 git('add','wiki/assets/lessons/first/result.webp');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','result frame','--no-verify');
 expect(()=>requireTrackedLessonSources(read())).not.toThrow();
});

it.each(['../private','/tmp/private','https://example.com/private'])('rejects capture paths outside the teaching source: %s',capture=>{
  const f=fixture();f.lesson.capture=capture;f.write();expect(f.read().issues.map(i=>i.code)).toContain('CAPTURE_PATH');
});

it('rejects image traversal and symlinked sources without reading their contents',()=>{
  const f=fixture();f.capture.frames[0].image='../secret.webp';f.write();expect(f.read().issues.map(i=>i.code)).toContain('IMAGE_PATH');
  f.capture.frames[0].image='01.webp';f.write();fs.unlinkSync(path.join(f.asset,'01.webp'));fs.symlinkSync(path.join(f.asset,'result.webp'),path.join(f.asset,'01.webp'));
  expect(f.read().issues.map(i=>i.code)).toContain('IMAGE_MISSING');
});

it('detects review drift when the teaching content changes while retaining the original review declaration',()=>{
  const f=fixture(),hash=f.read().lessons[0].contentSha256;
  Object.assign(f.lesson,{verification:{playback:{status:'passed',checkedAt:'2026-10-31T06:00:00Z',softwareCommit:'a'.repeat(40),contentSha256:hash},employee:{status:'pending'}}});f.write();
  expect(f.read().lessons[0].verification.playback.status).toBe('passed');
  f.lesson.steps[0].see='显示另一条来源';f.write();
  expect(f.read().lessons[0].verification.playback.status).toBe('stale');expect(f.read().verification.employee.pending).toBe(1);
});

it('does not publish unvalidated private strings as optional review metadata',()=>{
  const f=fixture();Object.assign(f.lesson,{verification:{playback:{status:'pending',softwareCommit:'/private/credential'}}});f.write();
  const c=f.read();expect(c.issues.map(i=>i.code)).toContain('VERIFICATION');expect(JSON.stringify(publicManualCatalog(c,{}))).not.toContain('/private/credential');
});

it('validates all currently delivered courses and preserves their undeclared verification state',()=>{
  const c=readLessonCatalog({git:false});expect(c.issues).toEqual([]);expect(c.totals).toEqual({lessons:27,steps:164,images:191});
  expect(c.tracks.map(t=>[t.name,t.lessons])).toEqual([['报价到订单',10],['采购与生产',4],['采购结算与付款',13]]);
  expect(c.verification.provenanceUnknown).toBe(27);expect(c.verification.employee.accepted).toBe(0);
});
