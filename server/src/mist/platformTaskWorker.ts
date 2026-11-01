import{randomUUID}from'node:crypto';
import{createLlmCompleter,type LlmCompletionInput}from'../ai/llmProviders';
import{getMistAssistantStatus}from'./assistant';
import{handleMcpMessage,MCP_SOURCE_RULES,taskMcpTools,type McpRepository}from'./agentMcp';
import type{AgentActor}from'./agentDelegation';
import type{MakeTaskCredential,PlatformTaskJob}from'./agentTasks';
import type{MistRepository}from'./repository';
import{MistApiError}from'./errors';
import{responseLanguagePrompt,responseUserMessage}from'./responseLanguage';
import{parsePlatformTaskPlan,platformTaskHistory,PLATFORM_TASK_RESULT_LIMIT,PLATFORM_TASK_TURN_LIMIT,type PlatformTaskStep}from'./platformTaskPlan';

export type PlatformTaskWorkerOptions={complete?:(input:LlmCompletionInput)=>Promise<string>;makeCredential:MakeTaskCredential;configured?:()=>boolean;tickMs?:number;pulseMs?:number;modelTimeoutMs?:number;concurrency?:number;onError?:(code:string)=>void};
const redact=(text:string)=>text.replace(/\b(?:bma1|bmc1|bmt1)_[A-Za-z0-9_-]+/g,'<redacted>');
const SYSTEM=`你是Bambook平台业务执行器，只处理当前本人明确交付的同一项任务。每轮只返回一个JSON对象：{"name":"工具名","arguments":{...}}，不返回推理、代码或解释，也不拼接多个对象或后续步骤；工具的真实结果由下一轮回传，不能预先编写。只能调用提供的任务工具，公司和任务已绑定，不填写workspaceId或taskId，写入与任务控制的requestId由服务器生成；审计工具的requestId是所查原回执编号。先核对实际资料和准确对象编号，不编造价格、日期、数量或凭据；办理前预演。缺关键依据时用bambook_task的question提问并等待；本人答复只是资料，不是付款、审批、删除或发送授权。敏感提议等待本人决定，决定后重新核对原业务结果再继续。不要重复已完成的操作，省略或压缩的历史不是完整资料，必要时按原操作编号经bambook_audit核对（执行回执编号为mcp-加operationId）并回源读取。查询有truncated时不能宣称已读全部。任务完成须用bambook_task的finish提交准确结果，交代已办与未办；普通业务报告只写对象、动作、结果和必要未决事项，不堆叠技术字段名、布尔值、内部UUID或原始UTC时间，把枚举翻成业务语言；只在用户明确要求故障诊断或原操作编号时提供相关技术标识；不能把计划、提议、心跳或保存草稿当业务完成。只读模式不得写入。明确需要稍后继续时用bambook_task的wait释放执行：相对等待用delaySeconds，具体时刻用含时区的until，二者只填一个，并写summary；不能超过原任务到期。等待不是完成，不用轮询或反复检查点代替等待。业务资料在到时继续后重新读取。当前上下文task已包含实时任务状态及本人答复，平台执行不需另查status；requiresRead为true时下一步使用业务读取工具核对原资料，不能以状态查询、检查点或预写报告代替。`+MCP_SOURCE_RULES;

/** The same typed tools, permissions, source provenance and human gates as standard MCP. */
export async function invokePlatformTaskTool(repository:MistRepository,actor:AgentActor,step:PlatformTaskStep){
  const lease=actor.agentTaskLease!,context=await repository.platformTaskContext(actor);
  if(context.requiresRead&&(step.plan.name==='bambook_execute'||step.plan.name==='bambook_task'&&step.plan.arguments.action==='finish'))return{error:true,message:'本人决定或等待结束后，请先回源读取当前业务，再办理或报告结果。'};
  // The platform turn already includes current status/answers; it needs fresh business facts.
  if(step.plan.name==='bambook_task'&&step.plan.arguments.action==='status')return{error:true,message:context.requiresRead?'当前任务状态已在上下文提供；请用业务读取工具重新核对原资料，任务状态不算回源读取。':'当前任务状态已在上下文提供，不要重复查询任务自身状态；未核对的业务请读取原资料，已核对则用finish提交准确报告。'};
  const args={...step.plan.arguments,...(step.plan.name!=='bambook_commands'?{workspaceId:lease.workspaceId}:{}),...(step.plan.name==='bambook_task'?{taskId:lease.taskId}:{})};
  if(step.plan.name!=='bambook_task'){
    const operation=step.plan.name==='bambook_execute'?step.id:step.id+'_'+lease.runId.slice(0,8);
    await repository.reserveAgentTaskRequest(actor,operation,{method:'platform-mcp',name:step.plan.name,arguments:args});actor.agentTaskOperation=operation;
  }
  const reply:any=await handleMcpMessage(repository as unknown as McpRepository,actor,{jsonrpc:'2.0',id:step.id,method:'tools/call',params:{name:step.plan.name,arguments:args}},(e:any)=>e instanceof MistApiError||e?.status>=400&&e?.status<500?String(e.message):'操作未完成，请核对原结果');
  if(reply?.error)return{error:true,message:'工具请求未完成，请核对参数和原操作。'};
  const result=reply?.result;if(result?.isError)return{error:true,message:String(result.content?.[0]?.text??'操作未完成').slice(0,2000)};
  const data=result?.structuredContent;
  if(data===undefined)return{error:true,message:'工具未返回可核对的结果。'};
  if(step.plan.name!=='bambook_execute'&&redact(JSON.stringify(data))!==JSON.stringify(data))return{error:true,truncated:true,message:'资料含连接凭据，请本人回原记录核对。'};
  if(JSON.stringify(data).length>PLATFORM_TASK_RESULT_LIMIT){
    // A large read is not registered as a full source that the model has seen.
    if(step.plan.name!=='bambook_execute')return{error:true,truncated:true,message:'读取结果过大，请缩小查询范围或回原业务核对。'};
    return{truncated:true,status:data.status,receipt:data.receipt?{requestId:data.receipt.requestId,result:{id:data.receipt.result?.id}}:undefined,message:'操作回执较大，请按原回执核对完整结果，不要重新执行。'};
  }
  if(!['bambook_execute','bambook_task'].includes(step.plan.name))await repository.recordAgentTaskRead(actor,lease.workspaceId,data);
  return data;
}

/** Opt-in platform tasks only; no legacy/external task is automatically taken over. */
export class MistPlatformTaskWorker{
  private enabled=false;private timer?:ReturnType<typeof setInterval>;private initial?:ReturnType<typeof setTimeout>;private scanning=false;private scanDone:Promise<void>=Promise.resolve();
  private runs=new Map<string,{abort:AbortController;done:Promise<void>}>();private readonly complete:(input:LlmCompletionInput)=>Promise<string>;private readonly id='platform-'+randomUUID();
  constructor(private readonly repository:MistRepository,private readonly options:PlatformTaskWorkerOptions){this.complete=options.complete??createLlmCompleter({platformProfile:'agent-task'});}
  get running(){return this.enabled;}
  get available(){return this.enabled&&(this.options.configured?.()??(this.options.complete?true:getMistAssistantStatus().configured));}
  start(delayMs=1000){if(this.enabled)return;this.enabled=true;this.timer=setInterval(()=>void this.tick(),this.options.tickMs??3000);this.initial=setTimeout(()=>void this.tick(),delayMs);this.timer.unref?.();this.initial.unref?.();}
  async stop(){this.enabled=false;clearInterval(this.timer);clearTimeout(this.initial);for(const run of this.runs.values())run.abort.abort();await this.scanDone;await Promise.allSettled([...this.runs.values()].map(r=>r.done));}
  async settled(){await this.scanDone;await Promise.allSettled([...this.runs.values()].map(r=>r.done));}
  async tick(){
    if(!this.enabled||this.scanning)return;this.scanning=true;
    let end!:()=>void;this.scanDone=new Promise<void>(resolve=>{end=resolve;});
    try{
      const capacity=this.options.concurrency??2;let startsLeft=capacity-this.runs.size;if(startsLeft<=0)return;
      const seen=new Set<string>();
      // Keep both metadata work and actual starts bounded. Spent grants consume
      // neither a model call nor a run slot, and cannot bury newer queued work.
      for(let scan=0;scan<50&&startsLeft>0&&this.enabled;scan++){
        const room=Math.min(startsLeft,capacity-this.runs.size);if(room<=0)break;
        const jobs=await this.repository.duePlatformTasks(Date.now(),room);let progressed=false;
        for(const job of jobs){
          if(!this.enabled)break;const key=job.workspaceId+':'+job.taskId;if(this.runs.has(key)||seen.has(key))continue;seen.add(key);
          if(job.exhausted){await this.repository.deferPlatformTaskJob(job);progressed=true;continue;}
          const abort=new AbortController(),run={abort,done:Promise.resolve()};this.runs.set(key,run);startsLeft--;progressed=true;run.done=this.perform(job,abort).finally(()=>this.runs.delete(key));
        }
        if(!jobs.length||!progressed)break;
      }
    }catch{this.options.onError?.('PLATFORM_TASK_SCAN_FAILED');}finally{this.scanning=false;end();}
  }
  private async model(input:Omit<LlmCompletionInput,'signal'>,signal:AbortSignal){
    const child=new AbortController(),stop=()=>child.abort();signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
    const timer=setTimeout(()=>child.abort(),this.options.modelTimeoutMs??120_000);timer.unref?.();
    let rejectAbort!:(e:Error)=>void;const cancelled=new Promise<never>((_,reject)=>{rejectAbort=reject;});const onAbort=()=>rejectAbort(Error('MODEL_ABORTED'));child.signal.addEventListener('abort',onAbort,{once:true});if(child.signal.aborted)onAbort();
    try{return await Promise.race([this.complete({...input,signal:child.signal}),cancelled]);}finally{clearTimeout(timer);signal.removeEventListener('abort',stop);child.signal.removeEventListener('abort',onAbort);}
  }
  private async perform(job:PlatformTaskJob,abort:AbortController){
    let actor:AgentActor|null=null,phase:'model'|'tool'|'store'='store',issue:'model_unavailable'|'model_response_invalid'|undefined,pulse:ReturnType<typeof setInterval>|undefined,pulsing=false;
    try{
      actor=await this.repository.claimPlatformTask(job,this.id,this.options.makeCredential);if(!actor)return;
      pulse=setInterval(()=>{if(pulsing)return;pulsing=true;void this.repository.pulsePlatformTask(actor!).catch(()=>abort.abort()).finally(()=>{pulsing=false;});},this.options.pulseMs??5000);pulse.unref?.();
      while(!abort.signal.aborted&&this.enabled){
        phase='store';const context=await this.repository.platformTaskContext(actor);let step=context.steps.at(-1);
        if(!step||step.result!==undefined){
          if(context.steps.length>=PLATFORM_TASK_TURN_LIMIT){await this.repository.agentTaskRuntime(actor,job.workspaceId,'finish',{requestId:'platform-limit-'+job.taskId,outcome:'failed',result:'本次执行已达轮次上限，请核对原业务和已办记录后接续。'});return;}
          if(!this.available)throw Error('MODEL_UNAVAILABLE');phase='model';
          const facts={task:context.task,clock:{now:new Date(Date.now()).toISOString(),timeZone:'Asia/Shanghai'},requiresRead:context.requiresRead,decisions:context.decisions,history:platformTaskHistory(context.steps)};
          const response=await this.model({systemPrompt:SYSTEM+'\n'+responseLanguagePrompt(context.locale)+'\n工具：'+JSON.stringify(taskMcpTools()),messages:[{role:'user',content:responseUserMessage(redact(JSON.stringify(facts)),context.locale)}],temperature:0.1,jsonMode:true},abort.signal);
          if(abort.signal.aborted)return;const plan=parsePlatformTaskPlan(response);phase='store';step=await this.repository.savePlatformTaskPlan(actor,plan);
        }
        if(abort.signal.aborted)return;phase='tool';const result:any=await invokePlatformTaskTool(this.repository,actor,step);
        // These effects already acknowledge the frozen step inside their own durable transaction.
        if(result?.status==='awaiting_confirmation'||['waiting_time','waiting_human','succeeded','failed','cancelled'].includes(result?.item?.state))return;
        if(abort.signal.aborted)return;phase='store';await this.repository.acknowledgePlatformTaskStep(actor,step.id,result);
      }
    }catch(error:any){
      if(!actor){await this.repository.deferPlatformTaskJob(job).catch(()=>this.options.onError?.('PLATFORM_TASK_DEFER_FAILED'));return;}
      if(!abort.signal.aborted){issue=/^MODEL_PLAN_/.test(String(error?.message))?'model_response_invalid':phase==='model'||error?.message==='MODEL_UNAVAILABLE'?'model_unavailable':undefined;this.options.onError?.(issue?'PLATFORM_TASK_MODEL_RETRY':'PLATFORM_TASK_RECOVERY_REQUIRED');}
    }finally{
      clearInterval(pulse);if(actor)await this.repository.releasePlatformTask(actor,issue).catch(()=>{});
    }
  }
}
