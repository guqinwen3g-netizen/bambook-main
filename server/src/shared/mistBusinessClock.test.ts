import {expect,it} from 'vitest';
import {alignMistScenarioTime,mistBusinessInstant} from './mistBusinessClock';
const fixed='2026-10-08T00:18:00.000Z';
it('uses a fixed instant only when supplied by valid internal metadata',()=>{
 const actual='2027-01-01T00:00:00.000Z';expect(mistBusinessInstant({settings:{}},actual)).toBe(actual);
 expect(mistBusinessInstant({settings:{businessClock:{mode:'fixed',at:fixed,timezone:'Asia/Shanghai'}}},actual)).toBe(fixed);
 expect(mistBusinessInstant({settings:{businessClock:{mode:'fixed',at:'2026-02-30T00:00:00.000Z',timezone:'Asia/Shanghai'}}},actual)).toBe(actual);
});
it('aligns current operations once while preserving closed history, identities, amounts and original evidence',()=>{
 const original={settings:{},orders:[{id:'SO-2026-0019',due:'2026-12-20',createdAt:'2026-10-19T04:00:00Z',amount:70000},{id:'old',due:'2026-09-25'}],tasks:[{due:'2026-10-20'}],events:[{at:'2026-10-19T13:00:00Z'}],files:[{id:'file',createdAt:'2026-10-19T13:00:00Z'}],email:{messages:[{sentAt:'2026-10-19T13:00:00Z'}]}};
 const next=alignMistScenarioTime(original,fixed);
 expect(next.orders[0]).toMatchObject({id:'SO-2026-0019',due:'2026-12-09',amount:70000});expect(next.orders[0].createdAt!<fixed).toBe(true);
 expect(next.orders[1]).toEqual(original.orders[1]);expect(next.tasks[0].due).toBe('2026-10-09');
 expect(next.events).toEqual(original.events);expect(next.files).toEqual(original.files);expect(next.email).toEqual(original.email);
 expect(alignMistScenarioTime(next,fixed)).toEqual(next);expect(original.tasks[0].due).toBe('2026-10-20');
 expect(()=>alignMistScenarioTime(next,'2026-10-09T00:18:00.000Z')).toThrow('shifted twice');
});
