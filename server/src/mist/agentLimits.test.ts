import {expect,it} from 'vitest';
import {agentTaskLimits,limitFromEnv} from './agentLimits';
it('keeps the shipped task budgets when nothing is configured',()=>{
 expect(agentTaskLimits({})).toEqual({steps:40,runtimeMs:30*60_000,activePerUser:10});
});
it('applies valid overrides and ignores malformed or out-of-range values',()=>{
 expect(agentTaskLimits({MIST_AGENT_TASK_STEP_LIMIT:'80',MIST_AGENT_TASK_RUNTIME_MINUTES:'60',MIST_AGENT_TASK_ACTIVE_PER_USER:'20'})).toEqual({steps:80,runtimeMs:60*60_000,activePerUser:20});
 for(const bad of ['0','4','201','-5','1.5','abc','','  ','1e3','99999999999999999999'])expect(limitFromEnv('X',40,5,200,{X:bad})).toBe(40);
 expect(limitFromEnv('X',40,5,200,{X:' 60 '})).toBe(60);
});
