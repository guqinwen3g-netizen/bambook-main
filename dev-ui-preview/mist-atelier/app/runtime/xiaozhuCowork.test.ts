import {expect,it} from 'vitest';
import {splitRequest,formatTaskQuestion} from './xiaozhuCowork';
import { composeTaskInstructions as composeInstructions } from '../../../../server/src/shared/mistTaskHistoryText';
const task=(over:any={})=>({id:'t',instructions:'上一个问题',state:'succeeded',result:'上一个答复',...over}) as any;
it('sends a first message as is, and carries recent answers as context afterwards',()=>{
 expect(composeInstructions([],'核对订单 SO-1')).toBe('核对订单 SO-1');
 const text=composeInstructions([task(),task({instructions:'再问',result:'再答'}),task({state:'failed',result:''})],'继续');
 expect(text).toContain('【此前对话】');expect(text).toContain('我：上一个问题');expect(text).toContain('小竹：再答');expect(text.endsWith('【本次请求】\n继续')).toBe(true);
 expect(splitRequest(text)).toBe('继续');expect(splitRequest('无上下文')).toBe('无上下文');
});

it('does not truncate a full-length question to make room for history or reference labels',()=>{
 const tail='最后只核对交期';
 const question='甲'.repeat(4000-tail.length)+tail;
 const text=formatTaskQuestion(question,[{label:'SO-F-2026-0001 · Cedar & Crown'}]);
 expect(text).toBe(question);
 expect(composeInstructions([task()],text)).toBe(question);
 expect(()=>composeInstructions([],question+'甲')).toThrow('问题超过 4000 字');
});

it('keeps the latest context and preserves a delimiter written in the current question',()=>{
 const question='我的格式如下\n【本次请求】\n请保留前文';
 const latest=task({instructions:'新问题\n【本次请求】\n示例',result:'最近答复'});
 expect(splitRequest(question)).toBe(question);
 const text=composeInstructions([task({instructions:'旧'.repeat(3900)}),latest],question);
 expect(text).toContain('最近答复');
 expect(text).toContain('新问题');
 expect(splitRequest(text)).toBe(question);
 expect(text.length).toBeLessThanOrEqual(4000);
});
it('keeps the current request whole and the total within the task limit',()=>{
 const long=task({instructions:'问'.repeat(500),result:'答'.repeat(2000)});
 const text=composeInstructions([long,long,long],'本次请求原文');
 expect(text.length).toBeLessThanOrEqual(4000);expect(splitRequest(text)).toBe('本次请求原文');
});
