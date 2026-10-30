import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {renderLesson,lessonRuntime} from './manual-lesson.mjs';
const lesson=JSON.parse(readFileSync(new URL('../wiki/lessons/settlement.json',import.meta.url),'utf8'));
const make=()=>{const dom=new JSDOM(renderLesson(lesson),{runScripts:'outside-only',pretendToBeVisual:true});dom.window.eval(lessonRuntime);const doc=dom.window.document;
 const q=(s:string)=>doc.querySelector(s) as HTMLElement,click=(s:string)=>q(s).click();return {dom,doc,q,click};};
it('walks the real settlement path: queue item, receipt amount, final-settlement judgement, submit and finance handoff',()=>{
 const {dom,q,click}=make();
 expect(q('[data-t="queue"]').classList.contains('is-target')).toBe(true);expect(q('[data-dialog]').hidden).toBe(true);
 click('[data-t="receipt"]');expect(q('[data-hint]').textContent).toBe('先点击蓝框标出的位置');
 click('[data-t="queue"]');expect(q('[data-dialog]').hidden).toBe(false);expect(q('[data-step="0"]').classList.contains('done')).toBe(true);
 click('[data-lesson-next]');click('[data-t="receipt"]');expect(q('[data-total]').textContent).toBe('700.00 CNY');
 click('[data-lesson-next]');click('[data-step-panel="2"] [data-choice="1"]');
 expect(q('[data-step="2"]').classList.contains('done')).toBe(false);expect(q('[data-t="final"]').getAttribute('aria-checked')).toBe('false');
 click('[data-step-panel="2"] [data-choice="0"]');expect(q('[data-step="2"]').classList.contains('done')).toBe(true);
 click('[data-lesson-next]');(q('[data-note]') as HTMLTextAreaElement).value='第一批已验收';click('[data-t="submit"]');
 expect(q('[data-dialog]').hidden).toBe(true);expect(q('[data-t="result"]').hidden).toBe(false);expect(q('[data-t="result"]').textContent).toContain('待财务复核');
 click('[data-lesson-next]');click('[data-t="result"]');expect(q('[data-settle-detail]').hidden).toBe(false);expect(q('[data-lesson-done]').hidden).toBe(false);
 click('[data-lesson-restart]');expect(q('[data-screen="home"]').hidden).toBe(false);expect((q('[data-note]') as HTMLTextAreaElement).value).toBe('');
 dom.window.close();
});
it('lets the reader jump, skip and preview a failure without losing the step state',()=>{
 const {dom,q,click}=make();
 click('[data-step="3"]');expect(q('[data-dialog]').hidden).toBe(false);expect(q('[data-t="receipt"]').getAttribute('aria-checked')).toBe('true');
 click('[data-step-panel="3"] [data-preview]');expect(q('[data-error]').hidden).toBe(false);expect(q('[data-t="receipt"]').getAttribute('aria-checked')).toBe('false');
 click('[data-step-panel="3"] [data-preview]');expect(q('[data-error]').hidden).toBe(true);expect(q('[data-t="receipt"]').getAttribute('aria-checked')).toBe('true');
 click('[data-lesson-next]');expect(q('[data-t="result"]').hidden).toBe(false);expect(q('[data-step="3"]').classList.contains('done')).toBe(true);
 click('[data-step="4"]');click('[data-step-panel="4"] [data-preview]');expect(q('[data-blocked-text]').textContent).toBe('已有待财务复核结算');
 dom.window.close();
});
it('plays a pausable demo that performs the same input and submit as the learner',async()=>{
 vi.useFakeTimers();const {dom,q,click}=make();
 try{
  click('[data-step="3"]');click('[data-play]');await vi.advanceTimersByTimeAsync(1600);
  click('[data-play]');expect(q('[data-play]').textContent).toBe('▶ 继续');const typed=(q('[data-note]') as HTMLTextAreaElement).value;
  await vi.advanceTimersByTimeAsync(3000);expect((q('[data-note]') as HTMLTextAreaElement).value).toBe(typed);expect(q('[data-t="result"]').hidden).toBe(true);
  click('[data-play]');await vi.advanceTimersByTimeAsync(5000);
  expect((q('[data-note]') as HTMLTextAreaElement).value).toBe(lesson.example.note);expect(q('[data-t="result"]').hidden).toBe(false);
 }finally{dom.window.close();vi.useRealTimers();}
});
it('has no company library, network form or business submission target',()=>{
 const html=renderLesson(lesson);
 expect(html).not.toMatch(/<form|action=|fetch\(|青屿|qingyu|SO-G-2026-0009|assets\/(?:finance|production)/);
 expect(lessonRuntime).not.toMatch(/fetch|XMLHttpRequest|localStorage/);
});
it('teaches finance confirmation: wrong choices do not advance, own submissions cannot be confirmed, confirmation unlocks billing',()=>{
 const confirm=JSON.parse(readFileSync(new URL('../wiki/lessons/settlement-confirm.json',import.meta.url),'utf8'));
 const dom=new JSDOM(renderLesson(confirm),{runScripts:'outside-only',pretendToBeVisual:true});dom.window.eval(lessonRuntime);
 const q=(s:string)=>dom.window.document.querySelector(s) as HTMLElement,click=(s:string)=>q(s).click();
 click('[data-t="queue"]');click('[data-lesson-next]');
 click('[data-t="return"]');expect(q('[data-step="1"]').classList.contains('done')).toBe(false);
 click('[data-step-panel="1"] [data-preview]');expect((q('[data-t="confirm"]') as HTMLButtonElement).disabled).toBe(true);click('[data-step-panel="1"] [data-preview]');
 click('[data-t="confirm"]');expect(q('[data-dialog]').hidden).toBe(false);
 click('[data-lesson-next]');click('[data-t="applied"]');expect(q('[data-step="2"]').classList.contains('done')).toBe(false);
 click('[data-step-panel="2"] [data-choice="0"]');click('[data-lesson-next]');click('[data-t="submit"]');
 expect(q('.mock-detail-h .mock-pill').textContent).toBe('已确认');expect(q('[data-t="bill"]').hidden).toBe(false);
 click('[data-lesson-next]');click('[data-t="bill"]');expect(q('[data-lesson-done]').hidden).toBe(false);
 dom.window.close();
});
