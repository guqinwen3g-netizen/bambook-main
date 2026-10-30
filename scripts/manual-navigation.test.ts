import {expect,it} from 'vitest';
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
