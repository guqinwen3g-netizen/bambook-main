// @vitest-environment jsdom
import React,{act}from'react';
import{createRoot}from'react-dom/client';
import{expect,it,vi}from'vitest';
import{fireEvent,getByRole}from'@testing-library/dom';
import{MistRoot}from'../../../../components/mist';
import{developmentReferenceFixture}from'../../../../server/src/shared/__tests__/utils/developmentReferences';
import{Nav}from'../nav';
import{DevelopmentReferenceBacklinks}from'./DevelopmentReferenceBacklinks';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
it('links the visible original physical item to the exact reference case without relabelling its source and marks withdrawal history briefly',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,source=structuredClone(f.sample()),go=vi.fn(),host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{const render=()=>act(()=>root.render(<MistRoot><Nav.Provider value={{route:{view:'samples',id:f.sampleId},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><DevelopmentReferenceBacklinks state={f.state} sampleIds={[f.sampleId]}/></Nav.Provider></MistRoot>));render();act(()=>fireEvent.click(getByRole(host,'button',{name:'打开参考开发案 '+f.dev().code})));expect(go).toHaveBeenCalledWith('development/detail',f.devId,{section:'reference:'+ref});expect(f.sample()).toEqual(source);f.run({type:'development.reference.remove',payload:{devId:f.devId,referenceId:ref,reason:'停止引用'}});render();expect(host.textContent).toContain('已撤回');
 }finally{act(()=>root.unmount());host.remove();}
});
it('never creates a reverse link for a missing sample, hidden development or an opaque relationship',()=>{
 const f=developmentReferenceFixture();f.link();const host=document.createElement('div'),root=createRoot(host);document.body.append(host);const go=vi.fn();
 try{f.state.fulfillment.samples=[];act(()=>root.render(<MistRoot><Nav.Provider value={{route:{view:'samples'},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><DevelopmentReferenceBacklinks state={f.state} sampleIds={[f.sampleId]}/></Nav.Provider></MistRoot>));expect(host.textContent).not.toContain('参考开发案');expect(go).not.toHaveBeenCalled();}finally{act(()=>root.unmount());host.remove();}
});
