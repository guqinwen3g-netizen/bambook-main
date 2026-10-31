import {expect,it,vi} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {renderLesson,lessonRuntime,loadCapture} from './manual-lesson.mjs';
const WIKI=fileURLToPath(new URL('../wiki',import.meta.url));
const lessons=readdirSync(`${WIKI}/lessons`).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(`${WIKI}/lessons/${f}`,'utf8')));
const settlement=lessons.find(l=>l.id==='tutorial-settlement');
const make=(lesson=settlement)=>{const dom=new JSDOM(renderLesson(lesson,loadCapture(WIKI,lesson)),{runScripts:'outside-only',pretendToBeVisual:true});dom.window.eval(lessonRuntime);
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
  expect(q('[data-lesson-done]').hidden).toBe(false);expect((q('[data-img]') as HTMLImageElement).getAttribute('src')).toBe('assets/lessons/settlement/result.webp');
 }finally{dom.window.close();vi.useRealTimers();}
});
