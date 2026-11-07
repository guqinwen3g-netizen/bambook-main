import {expect,it} from 'vitest';
import {composeInstructions,splitRequest} from './xiaozhuCowork';
const task=(over:any={})=>({id:'t',instructions:'上一个问题',state:'succeeded',result:'上一个答复',...over}) as any;
it('sends a first message as is, and carries recent answers as context afterwards',()=>{
 expect(composeInstructions([],'核对订单 SO-1')).toBe('核对订单 SO-1');
 const text=composeInstructions([task(),task({instructions:'再问',result:'再答'}),task({state:'failed',result:''})],'继续');
 expect(text).toContain('【此前对话】');expect(text).toContain('我：上一个问题');expect(text).toContain('小竹：再答');expect(text.endsWith('【本次请求】\n继续')).toBe(true);
 expect(splitRequest(text)).toBe('继续');expect(splitRequest('无上下文')).toBe('无上下文');
});
it('keeps the current request whole and the total within the task limit',()=>{
 const long=task({instructions:'问'.repeat(500),result:'答'.repeat(2000)});
 const text=composeInstructions([long,long,long],'本次请求原文');
 expect(text.length).toBeLessThanOrEqual(4000);expect(splitRequest(text)).toBe('本次请求原文');
});
