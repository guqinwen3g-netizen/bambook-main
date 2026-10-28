// @vitest-environment jsdom
import { expect,it,vi } from 'vitest';
import { createMistState } from '../../../../server/src/shared/mistWorkspace';
import { markNoticeSounds,newAudibleNotices } from './notificationSound';

it('announces only newly created unread and visible notices, not preference changes or history',()=>{
 const before=createMistState({id:()=>crypto.randomUUID(),now:'2026-10-13T00:00:00Z',actorName:'测试'},'empty');
 const notice=(id:string,view='development',category:'qc'|'general'='general',readAt:string|null=null)=>({id,title:id,detail:'',at:'2026-10-13',readAt,category,target:{view}});
 before.notifications=[notice('old'),notice('old-qc','development','qc')];before.settings.notifications.qc=false;
 const after=structuredClone(before);after.settings.notifications.qc=true;
 after.notifications.push(notice('new'),notice('hidden','shipments'),notice('read','development','general','2026-10-13'));
 expect(newAudibleNotices(before,after,view=>view!=='shipments')).toEqual(['new']);
});
it('shares deduplication across separate tabs',async()=>{
 localStorage.clear();
 vi.resetModules();const first=await import('./notificationSound');
 expect(first.markNoticeSounds('two-tabs',['shared-event'])).toBe(true);
 vi.resetModules();const second=await import('./notificationSound');
 expect(second.markNoticeSounds('two-tabs',['shared-event'])).toBe(false);
});
it('deduplicates each event by account and workspace without storing its contents',()=>{
 localStorage.clear();
 expect(markNoticeSounds('account-a:company-a',['notice-a','notice-b'])).toBe(true);
 expect(markNoticeSounds('account-a:company-a',['notice-a','notice-b'])).toBe(false);
 expect(markNoticeSounds('account-b:company-a',['notice-a'])).toBe(true);
 expect(markNoticeSounds('account-a:company-b',['notice-a'])).toBe(true);
 expect(localStorage.getItem('bambook.ui-sound.seen-notices.v1')).not.toContain('测试内容');
});
