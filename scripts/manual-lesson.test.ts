import {expect,it,vi} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {renderLesson,lessonRuntime,loadCapture} from './manual-lesson.mjs';
const WIKI=fileURLToPath(new URL('../wiki',import.meta.url));
const lessons=readdirSync(`${WIKI}/lessons`).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(`${WIKI}/lessons/${f}`,'utf8')));
const settlement=lessons.find(l=>l.id==='tutorial-settlement');
const readyImages=(window:any)=>{Object.defineProperties(window.HTMLImageElement.prototype,{complete:{configurable:true,get:()=>true},naturalWidth:{configurable:true,get:()=>2880}});};
const make=(lesson=settlement)=>{const dom=new JSDOM(renderLesson(lesson,loadCapture(WIKI,lesson)),{runScripts:'outside-only',pretendToBeVisual:true});readyImages(dom.window);dom.window.eval(lessonRuntime);
 const q=(s:string)=>dom.window.document.querySelector(s) as HTMLElement,click=(s:string)=>q(s).click();return {dom,q,click};};
it('every lesson matches its real-UI capture frame by frame and only references captured local images',()=>{
 for(const lesson of lessons){const capture=loadCapture(WIKI,lesson),html=renderLesson(lesson,capture);
  expect(capture.frames).toHaveLength(lesson.steps.length);
  for(const f of capture.frames){expect(f.target.width).toBeGreaterThan(0);expect(f.target.x+f.target.width).toBeLessThanOrEqual(capture.viewport.width);}
  expect([...html.matchAll(/assets\/lessons\/[\w-]+\/[\w.]+/g)].every(m=>m[0].startsWith(`assets/lessons/${lesson.capture}/`))).toBe(true);
  expect(html).not.toMatch(/<form|action=|青屿|qingyu|Panda|jiangsupanda/i);}
 expect(lessonRuntime).not.toMatch(/fetch|XMLHttpRequest|localStorage/);
});
it('practice: a click outside the highlighted control only hints; the highlighted control completes the step and next advances the frame',async()=>{
 const {dom,q,click}=make();
 expect((q('[data-img]') as HTMLImageElement).getAttribute('src')).toBe('assets/lessons/settlement/01.webp');
 click('[data-shot]');expect(q('[data-hint]').textContent).toBe('点击亮起的位置');expect(q('[data-step="0"]').classList.contains('done')).toBe(false);
 click('[data-hotspot]');await new Promise(r=>setTimeout(r,0));expect(q('[data-step="0"]').classList.contains('done')).toBe(true);
 click('[data-lesson-next]');expect((q('[data-img]') as HTMLImageElement).getAttribute('src')).toBe('assets/lessons/settlement/02.webp');
 click('[data-step="4"]');expect(q('[data-hotspot]').getAttribute('aria-label')).toBe(settlement.steps[4].tip);
 click('[data-step-panel="4"] [data-choice="1"]');expect(q('[data-step-panel="4"] [data-choice-reply]').textContent).toContain('不对');
 click('[data-step="6"]');click('[data-lesson-next]');await new Promise(r=>setTimeout(r,0));expect(q('[data-lesson-done]').hidden).toBe(false);
 dom.window.close();
});
it('demo: types the captured value, pauses without progress, resumes and finishes on the result frame',async()=>{
 vi.useFakeTimers();const {dom,q,click}=make();
 try{
  click('[data-step="5"]');click('[data-replay]');await vi.advanceTimersByTimeAsync(2000);
  click('[data-play]');expect(q('[data-play]').textContent).toBe('▶ 继续');const typed=q('[data-value]').textContent;
  expect(typed!.length).toBeGreaterThan(0);await vi.advanceTimersByTimeAsync(3000);expect(q('[data-value]').textContent).toBe(typed);
  click('[data-play]');await vi.advanceTimersByTimeAsync(6000);expect(q('[data-value]').textContent).toBe(settlement.steps[5].fill);expect(q('[data-step="5"]').classList.contains('done')).toBe(true);
  click('[data-step="6"]');click('[data-play]');await vi.advanceTimersByTimeAsync(8000);
  expect(q('[data-lesson-done]').hidden).toBe(false);expect((q('[data-img]') as HTMLImageElement).getAttribute('src')).toBe('assets/lessons/settlement/result.webp');expect(q('[data-player-state]').textContent).toContain('本课已完成');expect(q('[data-lesson-next]').textContent).toBe('已完成');
 }finally{dom.window.close();vi.useRealTimers();}
});

it('does not initialize hidden courses and stops their animation when navigation leaves them',async()=>{
 vi.useFakeTimers();const another={...settlement,id:'second-course'};
 const dom=new JSDOM('<input id="q">'+renderLesson(settlement,loadCapture(WIKI,settlement))+renderLesson(another,loadCapture(WIKI,settlement)),{runScripts:'outside-only',pretendToBeVisual:true});
 readyImages(dom.window);
 const [first,second]=[...dom.window.document.querySelectorAll<HTMLElement>('[data-lesson]')];first.hidden=true;second.hidden=true;
 try{
  dom.window.eval(lessonRuntime);expect(first.querySelector('[data-img]')?.getAttribute('src')).toBeNull();expect(second.querySelector('[data-img]')?.getAttribute('src')).toBeNull();
  first.hidden=false;dom.window.dispatchEvent(new dom.window.Event('hashchange'));
  expect(first.querySelector('[data-img]')?.getAttribute('src')).toContain('01.webp');expect(second.querySelector('[data-img]')?.getAttribute('src')).toBeNull();
  (first.querySelector('[data-play]') as HTMLButtonElement).click();await vi.advanceTimersByTimeAsync(600);
  first.hidden=true;second.hidden=false;dom.window.dispatchEvent(new dom.window.Event('hashchange'));
  const before=first.querySelector('[data-step-status]')?.textContent;expect(first.querySelector('[data-play]')?.getAttribute('data-state')).toBe('idle');expect(first.querySelector('[data-play]')?.getAttribute('aria-label')).toBe('播放演示');
  await vi.advanceTimersByTimeAsync(10000);expect(first.querySelector('[data-step-status]')?.textContent).toBe(before);expect(second.querySelector('[data-img]')?.getAttribute('src')).toContain('01.webp');
 }finally{dom.window.close();vi.useRealTimers();}
});

it('waits for a real image before enabling playback and does not claim completion when an image fails',async()=>{
 vi.useFakeTimers();const dom=new JSDOM(renderLesson(settlement,loadCapture(WIKI,settlement)),{runScripts:'outside-only',pretendToBeVisual:true});let ready=false;
 dom.window.Date.now=()=>Date.now();
 Object.defineProperties(dom.window.HTMLImageElement.prototype,{complete:{configurable:true,get:()=>ready},naturalWidth:{configurable:true,get:()=>ready?2880:0}});
 try{
  dom.window.eval(lessonRuntime);const doc=dom.window.document;
  expect((doc.querySelector('[data-play]') as HTMLButtonElement).disabled).toBe(true);expect(doc.querySelector('[data-player-state]')?.textContent).toContain('加载');
  ready=true;await vi.advanceTimersByTimeAsync(100);expect((doc.querySelector('[data-play]') as HTMLButtonElement).disabled).toBe(false);
  ready=false;(doc.querySelector('[data-step="6"]') as HTMLButtonElement).click();await vi.advanceTimersByTimeAsync(16000);
  expect((doc.querySelector('[data-media-error]') as HTMLElement).hidden).toBe(false);expect((doc.querySelector('[data-lesson-next]') as HTMLButtonElement).disabled).toBe(true);expect((doc.querySelector('[data-lesson-done]') as HTMLElement).hidden).toBe(true);
  expect(doc.querySelector('[data-media-reload]')?.textContent).toBe('重新加载课程');
 }finally{dom.window.close();vi.useRealTimers();}
});

it('does not let a cancelled result transition replace a newly selected step',async()=>{
 const {dom,q,click}=make();click('[data-step="6"]');click('[data-lesson-next]');click('[data-step="0"]');await new Promise(resolve=>setTimeout(resolve,0));
 expect(q('[data-lesson-done]').hidden).toBe(true);expect((q('[data-img]') as HTMLImageElement).getAttribute('src')).toContain('/01.webp');dom.window.close();
});
