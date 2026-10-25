// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, getByRole, queryByRole } from '@testing-library/dom';
import { FormFooter, MistAppShell, MistPage, MistRoot } from './index';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host=document.createElement('div'); document.body.append(host); root=createRoot(host); });
afterEach(() => { act(()=>root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('keeps form actions outside the field scroller while preserving live state and submission', () => {
  const submit=vi.fn();
  function Form() { const [value,setValue]=React.useState('');return <MistPage width="narrow"><input aria-label="Name" value={value} onChange={event=>setValue(event.target.value)}/><FormFooter><button onClick={()=>submit(value)}>Save</button></FormFooter></MistPage>; }
  act(()=>root.render(<MistRoot><MistAppShell sidebar={null} topbar={()=>null}><Form/></MistAppShell></MistRoot>));
  const scroller=host.querySelector('.mist-scroll')!,dock=host.querySelector('.mist-form-dock')!;
  expect(scroller.contains(getByRole(host,'textbox',{name:'Name'}))).toBe(true);
  expect(queryByRole(scroller as HTMLElement,'button',{name:'Save'})).toBeNull();
  expect(dock.contains(getByRole(host,'button',{name:'Save'}))).toBe(true);
  expect(dock.querySelector('[data-width="narrow"]')).not.toBeNull();
  act(()=>fireEvent.input(getByRole(host,'textbox',{name:'Name'}),{target:{value:'Current value'}}));
  act(()=>fireEvent.click(getByRole(host,'button',{name:'Save'})));
  expect(submit).toHaveBeenCalledExactlyOnceWith('Current value');
});

it('removes the docked actions when leaving the form, without retaining stale submit handlers', () => {
  const view=(show:boolean)=><MistRoot><MistAppShell sidebar={null} topbar={()=>null} scrollKey={show?'form':'list'}>{show?<MistPage><FormFooter><button>Save</button></FormFooter></MistPage>:<MistPage>List</MistPage>}</MistAppShell></MistRoot>;
  act(()=>root.render(view(true)));expect(getByRole(host,'button',{name:'Save'})).toBeTruthy();
  act(()=>root.render(view(false)));expect(queryByRole(host,'button',{name:'Save'})).toBeNull();
  expect(host.querySelector('.mist-form-dock')?.childElementCount).toBe(0);
});

it('keeps standalone forms usable without an application shell', () => {
  act(()=>root.render(<MistRoot><MistPage><FormFooter><button>Save</button></FormFooter></MistPage></MistRoot>));
  expect(host.querySelector('.mist-page')?.contains(getByRole(host,'button',{name:'Save'}))).toBe(true);
});

it('tracks the actual dock height when action rows wrap', () => {
  let measure:(()=>void)|undefined;
  vi.stubGlobal('ResizeObserver',class { constructor(callback:()=>void){measure=callback;} observe(){} disconnect(){} });
  act(()=>root.render(<MistRoot><MistAppShell sidebar={null} topbar={()=>null}><MistPage><FormFooter><button>Save</button></FormFooter></MistPage></MistAppShell></MistRoot>));
  const dock=host.querySelector('.mist-form-dock')!;
  vi.spyOn(dock,'getBoundingClientRect').mockReturnValue({height:128} as DOMRect);
  act(()=>measure?.());
  expect((host.querySelector('.mist-canvas') as HTMLElement).style.getPropertyValue('--mist-form-footer-height')).toBe('128px');
  vi.spyOn(dock,'getBoundingClientRect').mockReturnValue({height:69} as DOMRect);
  act(()=>measure?.());
  expect((host.querySelector('.mist-canvas') as HTMLElement).style.getPropertyValue('--mist-form-footer-height')).toBe('69px');
});
