import { randomUUID } from 'node:crypto';
import type { TokenPayload } from '../../auth/service';
import type { MistRepository } from '../repository';
import type { MailStateObservation } from '../../shared/mistMailState';
import { sameRemote } from '../../shared/mistEmail';
import type { MistMailService } from './service';
import type { MailSyncActor } from './receiverRegistry';
import type { MailStateRecord, MailStateAttempt } from './stateQueue';
import type { MailImapSession } from './transport';
import { describeMailError } from './transport';
import { stateFolders, locateMail, rawMailHash } from './stateProtocol';

const problem = (code:string,message:string) => Object.assign(new Error(message),{code});
/** Runs explicit employee/Agent intents, even when automatic inbox receiving is off. */
export class MistMailStateWorker {
  private enabled=false;
  private timer?:ReturnType<typeof setInterval>;
  private wakeTimer?:ReturnType<typeof setTimeout>;
  private scanning=false;
  private scanDone:Promise<void>=Promise.resolve();
  private runs=new Map<string,{controller:AbortController;done:Promise<void>}>();
  constructor(private readonly repository:MistRepository,private readonly mail:MistMailService,private readonly options:{tickMs?:number;localActor?:(id:string)=>Promise<TokenPayload>;onError?:(code:string)=>void}={}) {}
  get running(){return this.enabled;}
  start(){if(this.enabled)return;this.enabled=true;this.timer=setInterval(()=>void this.tick(),this.options.tickMs??5000);this.timer.unref?.();this.wake();}
  wake(){if(!this.enabled||this.wakeTimer)return;this.wakeTimer=setTimeout(()=>{this.wakeTimer=undefined;void this.tick();},0);this.wakeTimer.unref?.();}
  async stop(){this.enabled=false;clearInterval(this.timer);clearTimeout(this.wakeTimer);for(const r of this.runs.values())r.controller.abort();await this.scanDone;await Promise.allSettled([...this.runs.values()].map(r=>r.done));}
  async tick(){
    if(!this.enabled||this.scanning||this.runs.size>=2)return;
    this.scanning=true;let finish!:()=>void;this.scanDone=new Promise(resolve=>finish=resolve);const started:Promise<void>[]=[];
    try{for(const job of await this.repository.dueMailState(Date.now(),2-this.runs.size)){
      if(!this.enabled)break;if(this.runs.has(job.id))continue;
      const controller=new AbortController(),done=this.perform(job,controller.signal).finally(()=>{this.runs.delete(job.id);});
      this.runs.set(job.id,{controller,done});started.push(done);
    }}catch{this.options.onError?.('MAIL_STATE_SCAN_FAILED');}finally{this.scanning=false;finish();}
    await Promise.allSettled(started);
  }
  private async perform(initial:MailStateRecord,parent:AbortSignal){
    let job=initial,actor:MailSyncActor|undefined,session:MailImapSession|undefined;
    const controller=new AbortController(),abort=()=>controller.abort(),signal=controller.signal;
    parent.addEventListener('abort',abort,{once:true});if(parent.aborted)abort();
    const timeout=setTimeout(abort,90_000);timeout.unref?.();
    const wait=<T>(promise:Promise<T>)=>new Promise<T>((resolve,reject)=>{
      const stop=()=>reject(problem('MAIL_STATE_INTERRUPTED','邮件同步中断，请核对结果'));
      promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));
      if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
    });
    const check=async()=>{if(signal.aborted)throw problem('MAIL_STATE_INTERRUPTED','邮件同步已中断');if(actor)await this.repository.assertMailSync(actor,job.workspaceId);if(signal.aborted)throw problem('MAIL_STATE_INTERRUPTED','邮件同步已中断');};
    const close=()=>void session?.close(true).catch(()=>undefined);signal.addEventListener('abort',close,{once:true});
    let checking=false;
    const guard=setInterval(()=>{if(checking||!actor||signal.aborted)return;checking=true;void check().catch(()=>controller.abort()).finally(()=>checking=false);},15_000);guard.unref?.();
    try{
      const base=this.options.localActor?await this.options.localActor(job.authority.userId):{userId:job.authority.userId,roles:[],permissions:[],departmentIds:[],authorizationLoaded:true as const};
      const prior={...base,...job.authority,mailStateWorker:true};
      const claimed=await this.repository.claimMailState(prior,job);job=claimed.job;actor=claimed.actor;
      const connecting=this.mail.openStateSession(actor,job.workspaceId,job.accountId);
      void connecting.then(value=>{if(signal.aborted)void value.session.close(true);},()=>undefined);
      const connected=await wait(connecting);session=connected.session;
      if(!session.metadata)throw problem('MAIL_STATE_UNSUPPORTED','邮箱服务器暂不支持状态同步');
      const m=connected.state.email.messages.find(m=>m.id===job.messageId)!;
      const folders=stateFolders(await wait(session.folders()));
      let result:MailStateObservation|undefined;
      // A stored result is a network fact, not permission to issue the operation again.
      if(job.attempt?.result&&!job.acceptRemote){
        result=job.attempt.result;
        if(!sameRemote(m.remote!,result.expected)){
          const box=await wait(session.open(m.remote!.folder));
          const metadata=await wait(session.metadata([m.remote!.uid]));
          if(box.uidValidity!==m.remote!.uidValidity||metadata.length!==1)throw problem('MAIL_STATE_MISSING','原邮箱位置已变化，请核对');
          result={id:m.id,expected:m.remote!,remote:m.remote!,folder:m.remoteState?.folder||m.folder,read:metadata[0].seen,starred:metadata[0].starred};
        }
      }else if((job.attempt?.issued&&!job.attempt.confirmedNotApplied&&job.operation.kind==='move')||job.acceptRemote){
        const attempt=job.attempt;
        const origin=job.acceptRemote?m.remote!:(attempt?.origin||m.remote!);
        const box=await wait(session.open(origin.folder));
        const source=box.uidValidity===origin.uidValidity?await wait(session.metadata([origin.uid])):[];
        if(job.acceptRemote&&source.length===1)result={id:m.id,expected:m.remote!,remote:origin,folder:folders.find(f=>f.remote===origin.folder)?.folder||m.remoteState?.folder||m.folder,read:source[0].seen,starred:source[0].starred};
        else if(attempt){
          const matches=await wait(locateMail(session,attempt,folders,check));
          if(!source.length&&matches.length===1&&(job.acceptRemote||matches[0].remote.folder===attempt.target?.path))result={id:m.id,expected:m.remote!,...matches[0]};
          else if(source.length===1&&matches.filter(r=>r.remote.folder===attempt.target?.path).length===0){
            const verifiedBox=await wait(session.open(origin.folder)),raw=await wait(session.fetch([origin.uid]));
            if(verifiedBox.uidValidity===origin.uidValidity&&raw.length===1&&rawMailHash(raw[0].raw)===attempt.hash)throw problem('MAIL_MOVE_NOT_APPLIED','原移动未完成，请重试或以原邮箱为准');
            throw problem('MAIL_STATE_AMBIGUOUS','原邮箱位置或副本不明确，请先人工核对');
          }
          else throw problem('MAIL_STATE_AMBIGUOUS','原邮箱位置或副本不明确，请先人工核对');
        }else throw problem('MAIL_STATE_MISSING','原邮箱中未找到邮件，请先核对');
      }else{
        const operation=job.operation;
        await check();const box=await wait(session.open(m.remote!.folder,true));
        if(!Number.isSafeInteger(box.uidValidity)||box.uidValidity<1||box.uidValidity!==m.remote!.uidValidity)throw problem('MAIL_STATE_SOURCE_CHANGED','原邮箱编号已变化，请先同步邮箱');
        const metadata=await wait(session.metadata([m.remote!.uid]));
        if(metadata.length!==1)throw problem('MAIL_STATE_MISSING','原邮箱中未找到邮件，请先同步邮箱');
        let attempt:MailStateAttempt={id:randomUUID(),origin:m.remote!,messageId:m.messageId||'',issued:false};
        if(operation.kind==='move'){
          if(!session.canMove?.()||!session.move)throw problem('MAIL_MOVE_UNSUPPORTED','原邮箱不支持安全移动，请在原邮箱办理或以原邮箱为准');
          const target=folders.find(f=>f.folder===operation.folder);
          if(!target)throw problem('MAIL_TARGET_MISSING','原邮箱未提供目标文件夹，请在原邮箱配置后重试');
          if(target.remote===m.remote!.folder){
            attempt.issued=true;job=await this.repository.planMailState(job,attempt);
            result={id:m.id,expected:m.remote!,remote:m.remote!,folder:target.folder,read:metadata[0].seen,starred:metadata[0].starred};
          }else{
            const raw=await wait(session.fetch([m.remote!.uid]));if(raw.length!==1)throw problem('MAIL_STATE_MISSING','原邮箱邮件已变化，请先同步邮箱');
            attempt.hash=rawMailHash(raw[0].raw);if(m.remote!.hash&&attempt.hash!==m.remote!.hash)throw problem('MAIL_STATE_SOURCE_CHANGED','原邮箱原件不一致，请先核对');
            const targetBox=await wait(session.open(target.remote));if(!Number.isSafeInteger(targetBox.uidValidity)||targetBox.uidValidity<1||!Number.isSafeInteger(targetBox.uidNext)||targetBox.uidNext<1)throw problem('MAIL_STATE_SOURCE_CHANGED','原邮箱编号无效，请先核对');attempt.target={path:target.remote,folder:target.folder,...targetBox};
            const originBox=await wait(session.open(m.remote!.folder,true));if(originBox.uidValidity!==m.remote!.uidValidity)throw problem('MAIL_STATE_SOURCE_CHANGED','原邮箱编号已变化');
            attempt.issued=true;job=await this.repository.planMailState(job,attempt);await check();
            const uid=await wait(session.move!(m.remote!.uid,target.remote));
            if(uid){
              const box=await wait(session.open(target.remote));const raw=await wait(session.fetch([uid]));
              if(box.uidValidity===targetBox.uidValidity&&raw.length===1&&rawMailHash(raw[0].raw)===attempt.hash)result={id:m.id,expected:m.remote!,remote:{folder:target.remote,uid,uidValidity:box.uidValidity,hash:attempt.hash},folder:target.folder,read:raw[0].seen,starred:!!raw[0].starred};
            }
            if(!result){const matches=await wait(locateMail(session,attempt,[target],check));if(matches.length===1)result={id:m.id,expected:m.remote!,...matches[0]};}
            if(!result)throw problem('MAIL_STATE_AMBIGUOUS','移动结果待核对，请勿重复移动');
          }
        }else{
          if(!session.updateFlag)throw problem('MAIL_STATE_UNSUPPORTED','邮箱服务器暂不支持标记同步');
          attempt.issued=true;job=await this.repository.planMailState(job,attempt);await check();
          await wait(session.updateFlag(m.remote!.uid,operation.flag,operation.value));
          const after=await wait(session.metadata([m.remote!.uid]));if(after.length!==1||after[0][operation.flag==='read'?'seen':'starred']!==operation.value)throw problem('MAIL_STATE_REJECTED','原邮箱未保留该标记，将稍后重试');
          result={id:m.id,expected:m.remote!,remote:m.remote!,folder:m.remoteState?.folder||folders.find(f=>f.remote===m.remote!.folder)?.folder||m.folder,read:after[0].seen,starred:after[0].starred};
        }
      }
      if(!job.attempt?.issued){job=await this.repository.planMailState(job,{id:randomUUID(),origin:m.remote!,messageId:m.messageId||'',issued:true});}
      await this.repository.rememberMailState(job,result!);await check();
      await this.repository.executeMail(actor,job.workspaceId,{type:'email.server.state',payload:{accountId:job.accountId,source:job.source,operationId:job.id,attemptId:job.attempt!.id,observation:result!}});
    }catch(e:any){
      if(['MAIL_BUSY','MAIL_STATE_CHANGED'].includes(e?.code))return;
      const mailboxAuth=describeMailError(e,'imap').code==='MAIL_AUTH_FAILED';
      const taskStopped=typeof e?.code==='string'&&e.code.startsWith('AGENT_TASK_');
      const permission=taskStopped||mailboxAuth||[401,403,404].includes(e?.status)||['MAIL_SOURCE_CHANGED','MAIL_STATE_EXPIRED','MAIL_CREDENTIAL_MISSING'].includes(e?.code);
      const uncertain=job.operation.kind==='move'&&!!job.attempt?.issued&&!job.attempt.confirmedNotApplied;
      const phase=permission?'blocked':e?.code==='MAIL_MOVE_NOT_APPLIED'?'failed':uncertain?'unknown':['MAIL_MOVE_UNSUPPORTED','MAIL_TARGET_MISSING','MAIL_STATE_UNSUPPORTED','MAIL_STATE_SOURCE_CHANGED','MAIL_STATE_MISSING'].includes(e?.code)?'failed':'pending';
      const message=taskStopped?'原Agent任务不可继续，请本人核对后重试':mailboxAuth?'邮箱登录已失效，请接入人重新绑定凭据后重试':permission?'账号或邮箱授权已变化，请重新核对后重试':typeof e?.code==='string'&&e.code.startsWith('MAIL_')?e.message:'原邮箱暂时无法连接，稍后重试';
      if(actor)await this.repository.failMailState(job,phase,message,Date.now(),e?.code==='MAIL_MOVE_NOT_APPLIED').catch(()=>this.options.onError?.('MAIL_STATE_SAVE_FAILED'));
      else await this.repository.blockUnclaimedMailState(job,message).catch(()=>this.options.onError?.('MAIL_STATE_BLOCK_FAILED'));
    }finally{
      clearTimeout(timeout);clearInterval(guard);parent.removeEventListener('abort',abort);signal.removeEventListener('abort',close);
      await session?.close(signal.aborted).catch(()=>undefined);
      if(actor?.mailSyncLease)await this.repository.finishMailSync(actor.mailSyncLease,{ok:true}).catch(()=>undefined);
    }
  }
}
