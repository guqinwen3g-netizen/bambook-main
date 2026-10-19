import {afterEach,expect,it} from 'vitest';
import {bindBusinessClock,businessNow} from './businessClock';
afterEach(()=>bindBusinessClock(undefined));
it('uses the selected company clock without changing Date, and resets when leaving it',()=>{
 const real=Date.now();bindBusinessClock({mode:'fixed',at:'2026-10-08T00:18:00.000Z',timezone:'Asia/Shanghai'});
 expect(businessNow().toISOString()).toBe('2026-10-08T00:18:00.000Z');expect(Date.now()).toBeGreaterThanOrEqual(real);
 bindBusinessClock(undefined);expect(Math.abs(businessNow().getTime()-Date.now())).toBeLessThan(1000);
});
