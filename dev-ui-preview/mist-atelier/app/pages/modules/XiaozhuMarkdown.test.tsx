// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {expect,it,vi} from 'vitest';
import {XiaozhuMarkdown} from './XiaozhuMarkdown';
it('opens an explicit source link at the exact version and leaves foreign protocols inert',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host),open=vi.fn();document.body.append(host);
 try{await act(async()=>root.render(<XiaozhuMarkdown text={'[来源版本](bambook://open?view=development/detail&id=dev&versionId=old)\n[不可信](bambook://other?view=crm&id=private)\n[脚本](javascript:alert)\n![附件图片](https://example.invalid/track)'} index={[]} onOpen={open}/>));const buttons=host.querySelectorAll('button');expect(buttons).toHaveLength(1);await act(async()=>buttons[0].click());expect(open).toHaveBeenCalledWith('development/detail','dev',{versionId:'old'});expect(host.querySelectorAll('a')).toHaveLength(0);expect(host.querySelectorAll('img')).toHaveLength(0);
 }finally{await act(async()=>root.unmount());host.remove();}
});
