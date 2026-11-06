import {expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {manualNavigationRuntime} from './manual-navigation.mjs';
it('shows one learning page and restores the full navigation after an empty search',()=>{
 const d=new JSDOM('<input id="q"><nav class="nav-part"><a class="nav-item" data-target="start"></a><a class="nav-item" data-target="lesson"></a></nav><main id="content"><section id="start" class="chapter">首页</section><section id="lesson" class="chapter">结算</section></main>',{runScripts:'outside-only',url:'https://manual.example/#lesson'});
 d.window.eval(manualNavigationRuntime);const doc=d.window.document;
 expect((doc.getElementById('start') as HTMLElement).hidden).toBe(true);expect((doc.getElementById('lesson') as HTMLElement).hidden).toBe(false);
 const query=doc.getElementById('q') as HTMLInputElement;query.value='不存在';query.dispatchEvent(new d.window.Event('input'));
 expect((doc.querySelector('.nav-part') as HTMLElement).hidden).toBe(true);
 query.value='';query.dispatchEvent(new d.window.Event('input'));expect((doc.querySelector('.nav-part') as HTMLElement).hidden).toBe(false);expect(doc.getElementById('no-hit')).toBeNull();d.window.close();
});

it('opens and scrolls directly to a role heading, including after a search is cleared',()=>{
 const d=new JSDOM('<input id="q"><nav class="nav-part"><a class="nav-item" data-target="sop-overview"></a></nav><main id="content"><section id="start" class="chapter">首页</section><section id="sop-overview" class="chapter"><h3 id="sop-role-财务">财务</h3></section></main>',{runScripts:'outside-only',url:'https://manual.example/#sop-role-%E8%B4%A2%E5%8A%A1'});
 const doc=d.window.document,heading=doc.getElementById('sop-role-财务')!,scroll=vi.fn();heading.scrollIntoView=scroll;d.window.scrollTo=vi.fn();
 d.window.eval(manualNavigationRuntime);
 expect((doc.getElementById('sop-overview') as HTMLElement).hidden).toBe(false);expect((doc.getElementById('start') as HTMLElement).hidden).toBe(true);expect(scroll).toHaveBeenCalledOnce();
 const query=doc.getElementById('q') as HTMLInputElement;query.value='无匹配';query.dispatchEvent(new d.window.Event('input'));query.value='';query.dispatchEvent(new d.window.Event('input'));
 expect((doc.getElementById('sop-overview') as HTMLElement).hidden).toBe(false);expect(doc.getElementById('no-hit')).toBeNull();d.window.close();
});

it('prints only the requested course when a search exposes several courses and restores the reading state',()=>{
 const d=new JSDOM('<input id="q"><nav class="nav-part"></nav><main id="content"><section id="start" class="chapter">首页</section><section id="first" class="chapter">结算<button data-print>打印本课 SOP</button></section><section id="second" class="chapter">结算</section></main>',{runScripts:'outside-only',url:'https://manual.example/'});
 const doc=d.window.document;d.window.scrollTo=vi.fn();d.window.print=vi.fn(()=>{
  expect(doc.body.hasAttribute('data-print-sop')).toBe(true);expect([...doc.querySelectorAll('[data-print-selected]')].map(node=>node.id)).toEqual(['first']);
 });
 d.window.eval(manualNavigationRuntime);const query=doc.getElementById('q') as HTMLInputElement;query.value='结算';query.dispatchEvent(new d.window.Event('input'));
 expect((doc.getElementById('second') as HTMLElement).hidden).toBe(false);(doc.querySelector('[data-print]') as HTMLButtonElement).click();
 expect(d.window.print).toHaveBeenCalledOnce();expect(doc.body.hasAttribute('data-print-sop')).toBe(false);expect(doc.querySelector('[data-print-selected]')).toBeNull();expect(query.value).toBe('结算');expect((doc.getElementById('second') as HTMLElement).hidden).toBe(false);d.window.close();
});
