// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {createMistState} from '../../../../../server/src/shared/mistWorkspace';
import {Nav} from '../../nav';
import {PlatformReportsPage} from './PlatformReports';

const seam=vi.hoisted(()=>({state:null as any}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>({state:seam.state,workspace:{id:'w'}})}));
vi.mock('../../runtime/auth',()=>{const useMistSession=()=>({user:{id:'finance'},hasPermission:()=>true});return {useMistSession,useOptionalMistSession:useMistSession};});

it('filters a payout-only currency and prevents exporting a reversed cash-report date range',async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  seam.state=createMistState({id:()=> 'id',now:'2026-11-06T03:00:00Z',actorName:'财务'},'empty');
  seam.state.payments=[{date:'2026-11-03',amount:12600,currency:'CNY'}];
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const date=async(el:HTMLInputElement,value:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));});};
  try{
    await act(async()=>root.render(<Nav.Provider value={{route:{view:'reports',section:'cash'},go:vi.fn(),theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><PlatformReportsPage/></Nav.Provider>));
    const select=host.querySelector<HTMLSelectElement>('select[aria-label="币种"]')!;
    expect([...select.options].map(o=>o.value)).toContain('CNY');
    await act(async()=>{select.value='CNY';select.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(host.querySelector('[aria-label="资金月报"]')?.textContent).toContain('12,600.00');
    const fields=host.querySelectorAll<HTMLInputElement>('input[type="date"]');
    await date(fields[0], '2026-11-10');await date(fields[1], '2026-11-01');
    expect(host.textContent).toContain('起始日期不能晚于结束日期');
    for(const label of ['导出 CSV','导出 Excel'])expect([...host.querySelectorAll('button')].find(b=>b.textContent===label)?.disabled).toBe(true);
  }finally{await act(async()=>root.unmount());host.remove();}
});
