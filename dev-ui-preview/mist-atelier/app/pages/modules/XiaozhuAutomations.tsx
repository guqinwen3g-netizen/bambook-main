/** 小竹页的自动模式（2026-11-07 定案）：常驻规则，什么情况发生就做什么；触发一次做一次，要改业务的事留给本人确认。 */
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Banner, Button, Drawer, EmptyState, Field, IconButton, Pill, Select, Switch, TextArea, TextInput, useToast } from '../../../../../components/mist';
import { uiText, interfaceLocale } from '../../../../../services/interfaceLanguage';
import { mistApiRequest } from '../../runtime/workspace';
import { useNav } from '../../nav';
import { FailureNotice } from '../../runtime/FailureNotice';
import { withRequestDeadline } from '../../runtime/requestDeadline';

type Trigger = 'new_mail' | 'new_receipt' | 'due_soon' | 'daily';
type Rule = { id: string; name: string; trigger: Trigger; time: string; instructions: string; enabled: boolean; version: number; runs: Array<{ at: string; taskId: string; detail: string }>; halted?: { message: string } };
type RuleDraft = Pick<Rule,'trigger'|'name'|'instructions'|'time'>;
type RuleIntent = {requestId:string;draft:RuleDraft};
type RuleChange = {id:string;version:number} & ({kind:'toggle';enabled:boolean}|{kind:'delete'});
const TRIGGERS: Array<{ value: Trigger; label: string; name: string; instructions: string }> = [
  { value: 'new_mail', label: '收到新邮件', name: '新邮件整理', instructions: '读取新邮件，总结要点，判断是否需要跟进，并起草回复。' },
  { value: 'new_receipt', label: '收到新到账', name: '到账核对', instructions: '核对新到账，匹配对应应收，说明依据和需要人工确认的地方。' },
  { value: 'due_soon', label: '订单交期临近', name: '交期提醒', instructions: '检查交期临近的订单进度，列出风险和下一步。' },
  { value: 'daily', label: '每天定时', name: '每日汇总', instructions: '汇总今天需要处理的待办、逾期和风险。' },
];
const timed = (t: Trigger) => t === 'daily' || t === 'due_soon';
const label = (t: Trigger) => TRIGGERS.find(x => x.value === t)!.label;

const storageKey=(scope:string)=>'mist.xiaozhu.rule-submission:'+scope;
function readRuleIntent(scope:string):RuleIntent|undefined {
  try {
    const value=JSON.parse(sessionStorage.getItem(storageKey(scope))??'null');
    if(typeof value?.requestId==='string'&&/^[a-f0-9-]{36}$/i.test(value.requestId)
      &&TRIGGERS.some(item=>item.value===value.draft?.trigger)
      &&typeof value.draft.name==='string'&&typeof value.draft.instructions==='string'&&typeof value.draft.time==='string')
      return value;
  } catch { /* The active page can still retry in memory. */ }
}

export function XiaozhuAutomations({ open, onClose, workspaceId, scopeKey, seed, newRule, returnRuleId }: { open: boolean; onClose: () => void; workspaceId?: string; scopeKey?:string; seed?: string; newRule?: number; returnRuleId?: string }) {
  const { go } = useNav(), toast = useToast(), base = workspaceId ? '/api/mist/workspaces/' + encodeURIComponent(workspaceId) + '/agent-automations' : '';
  const scope=scopeKey??workspaceId??'';
  const liveScope=React.useRef(scope);liveScope.current=scope;
  const [rules, setRules] = React.useState<Rule[] | null>(null), [loading, setLoading] = React.useState(false);
  const [expandedRuns, setExpandedRuns] = React.useState<Record<string,boolean>>({});
  const returnedRule = React.useRef<HTMLDivElement>(null);
  const lastRestoredRule = React.useRef<string|undefined>(undefined);
  const [readError, setReadError] = React.useState(''), [error, setError] = React.useState('');
  const readGeneration = React.useRef(0);
  const listing=React.useRef<AbortController|undefined>(undefined);
  const [draft, setDraft] = React.useState<RuleDraft | null>(null), [busy, setBusy] = React.useState(false);
  const [pending,setPending]=React.useState<{scope:string;intent:RuleIntent}>();
  const activeIntent=React.useRef<RuleIntent|undefined>(undefined);
  const mutation=React.useRef<AbortController|undefined>(undefined);
  const uncertainChange=React.useRef<{scope:string;change:RuleChange}|undefined>(undefined);
  const pendingHere=pending?.scope===scope?pending.intent:undefined;
  const remember=(intent?:RuleIntent)=>{
    activeIntent.current=intent;
    setPending(intent?{scope,intent}:undefined);
    try{
      if(intent)sessionStorage.setItem(storageKey(scope),JSON.stringify(intent));
      else sessionStorage.removeItem(storageKey(scope));
    }catch{/* The active page can still retry in memory. */}
  };
  React.useEffect(()=>{
    const restored=readRuleIntent(scope);
    activeIntent.current=restored;
    setPending(restored?{scope,intent:restored}:undefined);
    setDraft(restored?.draft??null);
    uncertainChange.current=undefined;
    setRules(null);setExpandedRuns({});setError('');setReadError('');setBusy(false);
    return()=>{mutation.current?.abort();mutation.current=undefined;listing.current?.abort();readGeneration.current++;};
  },[scope]);
  const load = React.useCallback(async () => {
    if (!base) return;
    const generation = ++readGeneration.current;
    const checking=uncertainChange.current;
    const controller=new AbortController();
    listing.current?.abort();
    listing.current=controller;
    setLoading(true);
    try {
      const result = await withRequestDeadline(controller,8_000,'规则读取超时',signal =>
        mistApiRequest(base,{signal}) as Promise<{items:Rule[]}>);
      if (!Array.isArray(result.items)) throw new Error('规则响应无效');
      if (generation !== readGeneration.current || liveScope.current!==scope) return;
      setRules(result.items);
      setReadError('');
      if(checking?.scope===scope&&uncertainChange.current===checking){
        const {change}=checking;
        const currentRule=result.items.find(rule=>rule.id===change.id);
        const observed=change.kind==='delete'?!currentRule:
          !!currentRule&&Number.isSafeInteger(currentRule.version)&&currentRule.version>change.version&&currentRule.enabled===change.enabled;
        if(observed){uncertainChange.current=undefined;setError('');}
      }
    } catch (e) {
      if (generation !== readGeneration.current || liveScope.current!==scope) return;
      if (e instanceof Error && 'status' in e && [401, 403, 404].includes(Number(e.status))) setRules(null);
      setReadError(e instanceof Error ? e.message : '读取失败');
    } finally {
      if (generation === readGeneration.current&&liveScope.current===scope){listing.current=undefined;setLoading(false);}
    }
  }, [base,scope]);
  React.useEffect(() => {
    if (open) void load();
    else {
      setExpandedRuns({});
      if (!activeIntent.current) setDraft(null);
    }
  }, [open, load]);
  React.useEffect(() => {
    if (!open || !returnRuleId) {
      lastRestoredRule.current = undefined;
      return;
    }
    if (!returnedRule.current || lastRestoredRule.current === returnRuleId) return;
    returnedRule.current.scrollIntoView?.({block:'start',inline:'nearest'});
    lastRestoredRule.current = returnRuleId;
  }, [open, returnRuleId, rules]);
  React.useEffect(() => { if (open && seed && !activeIntent.current) setDraft({ trigger: 'daily', name: seed.slice(0, 20), instructions: seed, time: '09:00' }); }, [open, seed]);
  React.useEffect(() => { if (open && newRule && !activeIntent.current) start(); }, [open, newRule]);
  React.useEffect(() => { if (!open) return; const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 10_000); return () => clearInterval(timer); }, [open, load]);
  const start = () => { const t = TRIGGERS[0]; setDraft({ trigger: t.value, name: t.name, instructions: t.instructions, time: '09:00' }); };
  const pick = (value: Trigger) => { const t = TRIGGERS.find(x => x.value === value)!; setDraft(d => d && { ...d, trigger: value, name: t.name, instructions: t.instructions }); };
  const act = async <T,>(change:RuleChange,run:(signal:AbortSignal)=>Promise<T>,apply:(result:T)=>void) => {
    if(busy||activeIntent.current||mutation.current)return;
    const controller=new AbortController();
    mutation.current=controller;
    const current=()=>liveScope.current===scope&&mutation.current===controller;
    uncertainChange.current=undefined;setBusy(true);setError('');
    try {
      const result=await withRequestDeadline(controller,10_000,'规则操作结果待核对',run);
      if(current())apply(result);
    } catch (problem) {
      if(current()){
        const status=(problem as {status?:number})?.status;
        if(!status||status===408||status>=500)uncertainChange.current={scope,change};
        setError(status===409?'规则已更新，请核对后重试':problem instanceof Error?problem.message:'操作未完成');
      }
    } finally {
      if(current()){
        mutation.current=undefined;setBusy(false);
        void load();
      }
    }
  };
  const create = async () => {
    if(!base||!draft||busy||mutation.current)return;
    const original=activeIntent.current;
    const intent=original??{requestId:crypto.randomUUID(),draft};
    const controller=new AbortController();
    mutation.current=controller;
    const isCurrent=()=>liveScope.current===scope&&mutation.current===controller;
    uncertainChange.current=undefined;remember(intent);setBusy(true);setError('');
    try {
      const result=await withRequestDeadline(controller,10_000,'规则开启结果待核对',signal=>
        mistApiRequest(base,{method:'POST',signal,body:JSON.stringify({...intent.draft,enabled:true,requestId:intent.requestId})}) as Promise<{item:Rule}>);
      if(!isCurrent())return;
      if(!result.item?.id)throw new Error('规则开启结果待核对');
      remember();setDraft(null);
      setRules(old=>[result.item,...(old??[]).filter(rule=>rule.id!==result.item.id)]);
      toast(uiText(result.item.enabled?'规则已开启':'已找回原规则'));
      void load();
    } catch (problem) {
      if(!isCurrent())return;
      const {status=0,code}=(problem as {status?:number;code?:string})??{};
      if(code==='AGENT_AUTOMATION_CREATED_RULE_GONE'||!original&&status>=400&&status<500&&![408,409,429].includes(status))remember();
      setError(problem instanceof Error?problem.message:'规则开启结果待核对');
    } finally {
      if(isCurrent()){mutation.current=undefined;setBusy(false);}
    }
  };
  const toggle = (rule:Rule,enabled:boolean) => act({kind:'toggle',id:rule.id,version:rule.version,enabled},signal=>
    mistApiRequest(base+'/'+encodeURIComponent(rule.id),{
      method:'PATCH',signal,body:JSON.stringify({enabled,expectedVersion:rule.version}),
    }) as Promise<{item:Rule}>,result=>{
      if(result.item?.id!==rule.id)throw Error('规则操作结果待核对');
      setRules(old=>old?.map(item=>item.id===rule.id&&item.version<=result.item.version?result.item:item)??old);
    });
  const remove = (rule:Rule) => act({kind:'delete',id:rule.id,version:rule.version},signal=>
    mistApiRequest(base+'/'+encodeURIComponent(rule.id)+'?expectedVersion='+encodeURIComponent(rule.version),{
      method:'DELETE',signal,
    }) as Promise<{removed?:boolean}>,result=>{
      if(result?.removed!==true)throw Error('规则操作结果待核对');
      setRules(old=>old?.filter(item=>item.id!==rule.id)??old);
    });
  return <Drawer open={open} onClose={onClose} size="lg" title={uiText('自动')} tone="ai" footer={draft ? undefined : <Button icon={Plus} variant="primary" onClick={start}>{uiText('新建规则')}</Button>}>
    <div className="mist-col">
      {readError && <FailureNotice title={uiText("规则读取失败")} detail={readError} retry={loading ? undefined : () => void load()} retryLabel="重新读取" />}
      {error&&!pendingHere&&<Banner tone="bad" title={uiText(error)} />}
      {draft && <div className="mist-col">
        {pendingHere&&!busy&&<Banner tone="warn" title={uiText('规则开启结果待核对')}>
          {error&&error!=='规则开启结果待核对'?uiText(error):undefined}
        </Banner>}
        <Field label={uiText('什么时候')} required><Select aria-label={uiText('触发条件')} disabled={!!pendingHere} value={draft.trigger} options={TRIGGERS.map(t => ({ value: t.value, label: uiText(t.label) }))} onChange={e => pick(e.target.value as Trigger)} /></Field>
        {timed(draft.trigger) && <Field label={uiText('每天几点')}><TextInput aria-label={uiText('每天几点')} disabled={!!pendingHere} type="time" value={draft.time} onChange={e => setDraft({ ...draft, time: e.target.value })} /></Field>}
        <Field label={uiText('规则名称')} required><TextInput aria-label={uiText('规则名称')} disabled={!!pendingHere} value={draft.name} maxLength={40} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label={uiText('要做什么')} required><TextArea aria-label={uiText('规则要做什么')} disabled={!!pendingHere} rows={3} maxLength={2000} value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></Field>
        <div className="mist-row"><span className="mist-spacer" /><Button disabled={busy||!!pendingHere} onClick={() => setDraft(null)}>{uiText('取消')}</Button><Button variant="primary" loading={busy} disabled={busy || !draft.name.trim() || !draft.instructions.trim()} onClick={() => void create()}>{uiText(pendingHere?'用原请求重试':'开启')}</Button></div>
      </div>}
      {rules?.length === 0 && !draft && !loading && !readError && <EmptyState title={uiText('还没有规则')} compact />}
      {rules?.map(r => {
        const expanded = expandedRuns[r.id] ?? (r.id === returnRuleId), runsId = 'mist-rule-runs-' + r.id;
        const runs = expanded ? r.runs : r.runs.slice(0, 3);
        return <div className="mist-col mist-section" key={r.id} ref={r.id===returnRuleId?returnedRule:undefined}>
          <div className="mist-row"><b>{r.name}</b><Pill tone="ai">{uiText(label(r.trigger))}{timed(r.trigger) ? ' ' + r.time : ''}</Pill><span className="mist-spacer" />
            <Switch ariaLabel={uiText(`开启 ${r.name}`)} checked={r.enabled} disabled={busy||!!pendingHere} onChange={v => void toggle(r, v)} />
            <IconButton icon={Trash2} label={uiText(`删除 ${r.name}`)} disabled={busy||!!pendingHere} onClick={() => void remove(r)} /></div>
          {r.halted && <Banner tone="warn" title={uiText(r.halted.message)} />}
          <p className="mist-sub">{r.instructions}</p>
          {!!runs.length && <div className="mist-col" id={runsId}>
            {runs.map(run => <div className="mist-row" key={run.taskId}><span className="mist-note">{new Date(run.at).toLocaleString(interfaceLocale(),{timeZone:'Asia/Shanghai',hour12:false})} · {run.detail}</span><span className="mist-spacer" /><Button size="sm" variant="quiet" onClick={() => go('assistant', run.taskId, { section: 'tasks', automationId:r.id })}>{uiText('查看')}</Button></div>)}
          </div>}
          {r.runs.length > 3 && <div className="mist-row">
            <Button size="sm" variant="quiet" aria-expanded={expanded} aria-controls={runsId}
              onClick={() => setExpandedRuns(current => ({...current, [r.id]: !(current[r.id] ?? (r.id === returnRuleId))}))}>
              {uiText(expanded ? '收起运行记录' : '查看全部运行记录')}
            </Button>
          </div>}
        </div>;
      })}
    </div>
  </Drawer>;
}
