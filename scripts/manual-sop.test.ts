import {expect,it} from 'vitest';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {readLessonCatalog} from './manual-catalog.mjs';
import {linkTextSops,readTextSops,renderLessonSop,renderSopOverview} from './manual-sop.mjs';

const wiki=fileURLToPath(new URL('../wiki',import.meta.url));
const lessons=readLessonCatalog().lessons.map(row=>row.lesson);
const sops=readTextSops(wiki);

it('keeps each real lesson’s entry, actions, expected results and handoff together in its printable SOP',()=>{
 for(const lesson of lessons){
  const dom=new JSDOM(renderLessonSop(lesson)),doc=dom.window.document;
  expect(doc.querySelectorAll('.sop-steps tbody tr')).toHaveLength(lesson.steps.length);
  for(const text of [lesson.role,lesson.prerequisite,lesson.entry,lesson.handoff,lesson.result])expect(doc.body.textContent).toContain(text);
  for(const step of lesson.steps)for(const text of [step.do,step.see,step.fill].filter(Boolean))expect(doc.body.textContent).toContain(text);
  if(lesson.nextLesson)expect(doc.querySelector('a')?.getAttribute('href')).toBe('#'+lesson.nextLesson.id);
  dom.window.close();
 }
});

it('escapes lesson content instead of turning recorded input into HTML',()=>{
 const lesson=structuredClone(lessons[0]);lesson.steps[0].fill='<img src=x onerror="alert(1)">';
 const dom=new JSDOM(renderLessonSop(lesson));
 expect(dom.window.document.querySelector('img')).toBeNull();expect(dom.window.document.body.textContent).toContain(lesson.steps[0].fill);dom.window.close();
});

it('links every existing course and text SOP from the role overview without duplicating section IDs',()=>{
 const dom=new JSDOM(renderSopOverview(lessons,lesson=>lesson.track||'采购结算与付款',sops)),doc=dom.window.document;
 for(const lesson of lessons)expect([...doc.querySelectorAll('a')].some(a=>a.getAttribute('href')==='#'+lesson.id)).toBe(true);
 for(const sop of sops)expect([...doc.querySelectorAll('a')].some(a=>a.getAttribute('href')==='#'+sop.id)).toBe(true);
 const ids=[...doc.querySelectorAll('[id]')].map(node=>node.id);expect(new Set(ids).size).toBe(ids.length);dom.window.close();
});

it('resolves cross-SOP links and their heading fragments while leaving external URLs usable',()=>{
 const html=linkTextSops('<a href="agent-tasks.md">任务</a><a href="./agent-tasks.md#开始条件">条件</a><a href="https://example.com">网站</a><a href="missing.md">旧文档</a>',sops);
 const dom=new JSDOM(html),links=[...dom.window.document.querySelectorAll('a')];
 expect(links.map(link=>link.getAttribute('href'))).toEqual(['#sop-agent-tasks','#sop-agent-tasks-开始条件','https://example.com',null]);dom.window.close();
});
