import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {renderLesson,lessonRuntime} from './manual-lesson.mjs';
const lesson=JSON.parse(readFileSync(new URL('../wiki/lessons/settlement.json',import.meta.url),'utf8'));
const make=()=>{const dom=new JSDOM(renderLesson(lesson),{runScripts:'outside-only'});dom.window.eval(lessonRuntime);return dom;};
it('requires the learner to choose a contract, count real receipt quantities and enter a basis before finishing',()=>{
 const d=make(),doc=d.window.document,click=(s:string)=>(doc.querySelector(s) as HTMLButtonElement).click(),change=(el:Element)=>el.dispatchEvent(new d.window.Event('change',{bubbles:true}));
 click('[data-training-open]');expect((doc.querySelector('[data-lesson-next]') as HTMLButtonElement).disabled).toBe(true);
 const contract=doc.querySelector('[data-training-contract]') as HTMLSelectElement;contract.value='example';change(contract);click('[data-lesson-next]');
 expect((doc.querySelector('[data-lesson-next]') as HTMLButtonElement).disabled).toBe(true);
 const receipt=doc.querySelector('[data-training-receipt]') as HTMLInputElement;receipt.checked=true;change(receipt);
 expect(doc.querySelector('[data-practice-total]')?.textContent).toBe('700.00 元');
 click('[data-lesson-prev]');contract.value='';change(contract);expect(receipt.checked).toBe(false);expect(doc.querySelector('[data-practice-total]')?.textContent).toBe('0.00 元');
 contract.value='example';change(contract);click('[data-lesson-next]');receipt.checked=true;change(receipt);click('[data-lesson-next]');
 const submit=doc.querySelector('[data-training-submit]') as HTMLButtonElement;expect(submit.disabled).toBe(true);
 const note=doc.querySelector('[data-training-note]') as HTMLTextAreaElement;note.value='已验收，按合同单价结算';note.dispatchEvent(new d.window.Event('input',{bubbles:true}));
 click('[data-training-submit]');expect((doc.querySelector('[data-lesson-done]') as HTMLElement).hidden).toBe(false);
 click('[data-lesson-restart]');expect(contract.value).toBe('');expect(receipt.checked).toBe(false);expect(note.value).toBe('');
 d.window.close();
});
it('cannot finish by jumping to the last step and has no company library, network form or business submission target',()=>{
 const d=make(),doc=d.window.document;(doc.querySelector('[data-step="3"]') as HTMLButtonElement).click();
 expect((doc.querySelector('[data-training-submit]') as HTMLButtonElement).disabled).toBe(true);
 expect(doc.querySelector('form')?.hasAttribute('action')).toBe(false);
 expect(renderLesson(lesson)).not.toMatch(/青屿|qingyu|SO-G-2026-0009|assets\/(?:finance|production)/);
 d.window.close();
});
