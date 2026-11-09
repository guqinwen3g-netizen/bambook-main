import { calendarSourceId, calendarVisibleTo, calendarWithDerived, isDerivedCalendarEvent } from '../runtime/derivedCalendar';
import { workspaceMembers } from '../runtime/members';
import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../services/interfaceLanguage';
import {businessNow} from '../runtime/businessClock';
import React from 'react';
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import {
  Agenda, Banner, Button, Card, CardBody, CardFooter, CardHeader, EmptyState, Field, FormGrid,
  MistPage, PageHeader, Select, Skeleton, TextArea, TextInput, TextLink, Toolbar, WeekStrip, useToast, Segmented, Checkbox,
} from '../../../../components/mist';
import type { MistCalendarEvent, MistTarget } from '../../../../server/src/shared/mistWorkspace';
import { useMistWorkspace } from '../runtime/workspace';
import { useMistSession } from '../runtime/auth';
import { useNav } from '../nav';
import { FailureNotice } from '../runtime/FailureNotice';

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const parseDay = (date: string) => new Date(`${date}T12:00:00`);
const shiftDay = (date: string, distance: number) => { const result=parseDay(date); result.setDate(result.getDate()+distance); return dayKey(result); };
export function calendarWeek(date: string) {
  const selected=parseDay(date),offset=(selected.getDay()+6)%7,first=shiftDay(date,-offset);
  return Array.from({length:7},(_,index)=>({key:shiftDay(first,index),weekday:['一','二','三','四','五','六','日'][index],day:parseDay(shiftDay(first,index)).getDate()}));
}
export function calendarFormError(form: {title:string;date:string;time:string}) {
  if(!form.title.trim())return '请填写日程名称';
  const parsed=parseDay(form.date);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date)||Number.isNaN(parsed.getTime())||dayKey(parsed)!==form.date)return '请选择有效日期';
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.time))return '请选择有效时间';
  return null;
}

/** mar60：月视图。点日期切到当天列表。 */
function MonthGrid({ selected, counts, onPick }: { selected: string; counts: Map<string, number>; onPick: (day: string) => void }) {
  const first = new Date(selected.slice(0, 8) + '01T00:00:00Z'), lead = (first.getUTCDay() + 6) % 7, total = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const keys = Array.from({ length: total }, (_, i) => selected.slice(0, 8) + String(i + 1).padStart(2, '0')), weeks: string[][] = [];
  const cells = [...Array(lead).fill(''), ...keys]; for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return <div aria-label={uiText('月视图')}>{weeks.map((w, n) => <div key={n} className="mist-week">{w.map((d, i) => d ? <button key={d} type="button" aria-pressed={d === selected} onClick={() => onPick(d)}><span>{uiText(['一', '二', '三', '四', '五', '六', '日'][i])}</span><b>{Number(d.slice(8))}</b><span className="mist-week-dots">{Array.from({ length: Math.min(counts.get(d) || 0, 3) }, (_, k) => <i key={k} />)}</span></button> : <span key={'e' + i} />)}</div>)}</div>;
}
/** 只发送有值或需要清除的参与人、提醒、重复字段。 */
function calendarExtras(x:{participantIds:string[];remind:string;repeat:''|'week'|'month';until:string},old?:MistCalendarEvent){
  return {...(x.participantIds.length||old?.participants?.length?{participantIds:x.participantIds}:{}),...(Number(x.remind)||old?.remindMinutes?{remindMinutes:Number(x.remind)||0}:{}),...(x.repeat?{repeat:{every:x.repeat,until:x.until}}:old?.repeat?{repeat:null}:{})};
}
export function CalendarPage() {
  const {go,route}=useNav();const {state,workspace,loading,error,run,refresh,pending,recover,saving}=useMistWorkspace();const session=useMistSession();const toast=useToast();
  const scopeKey=`${session.sessionKey}:${workspace?.id||''}`;
  const [selected,setSelected]=React.useState(()=>dayKey(businessNow()));
  const [mode,setMode]=React.useState<'week'|'month'>('week'),[mineOnly,setMineOnly]=React.useState(false),[personal,setPersonal]=React.useState(false);
  const me=session.user?.id||'';
  React.useEffect(()=>{if(!route.section)setSelected(dayKey(businessNow()));},[scopeKey,state?.settings.businessClock?.at,route.section]);
  const [editing,setEditing]=React.useState<string|null|undefined>(undefined);
  const [form,setForm]=React.useState({title:'',date:selected,time:'09:00',note:'',targetKey:''});
  const [extra,setExtra]=React.useState<{participantIds:string[];remind:string;repeat:''|'week'|'month';until:string}>({participantIds:[],remind:'',repeat:'',until:''});
  const members=workspaceMembers(workspace,state,session.user?{id:session.user.id,displayName:session.user.displayName}:null).filter(m=>m.id!==me);
  const [originalTarget,setOriginalTarget]=React.useState<MistTarget|undefined>();
  const [busy,setBusy]=React.useState(false),[failure,setFailure]=React.useState('');
  const [formScope,setFormScope]=React.useState(scopeKey);
  const live=React.useRef(true),locked=React.useRef(false),scope=React.useRef(scopeKey),sequence=React.useRef(0);
  if(scope.current!==scopeKey){scope.current=scopeKey;sequence.current++;locked.current=false;}
  const activeEditing=formScope===scopeKey?editing:undefined;
  const visibleFailure=formScope===scopeKey?failure:'';
  React.useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  React.useEffect(()=>{setEditing(undefined);setForm({title:'',date:dayKey(businessNow()),time:'09:00',note:'',targetKey:''});setOriginalTarget(undefined);setFailure('');setBusy(false);setFormScope(scopeKey);},[scopeKey]);
  const allEvents=calendarWithDerived(state).filter(event=>calendarVisibleTo(event,me)).filter(event=>!mineOnly||event.ownerId===me||!!event.participants?.some(p=>p.id===me)),events=allEvents.filter(event=>event.date===selected).slice().sort((a,b)=>a.time.localeCompare(b.time)||a.title.localeCompare(b.title));
  const week=calendarWeek(selected).map(day=>({...day,dots:allEvents.filter(event=>event.date===day.key).length}));
  React.useEffect(()=>{if(route.section&&!calendarFormError({title:'日期',date:route.section,time:'09:00'}))setSelected(route.section);},[route.section]);
  React.useEffect(()=>{if(activeEditing!==undefined){const editor=document.getElementById('mist-calendar-editor');editor?.scrollIntoView?.({behavior:'smooth',block:'start'});editor?.querySelector<HTMLInputElement>('input')?.focus();}},[activeEditing]);
  const targets: Array<{value:string;label:string;target:MistTarget}>= [
    ...(state?.devs.map(dev=>({value:`development:${dev.id}`,label:`${dev.code} · ${dev.name}`,target:{view:'development/detail',id:dev.id,versionId:dev.currentVersionId||undefined}}))||[]),
    ...(state?.orders.map(order=>({value:`order:${order.id}`,label:`${order.code} · ${order.customer}`,target:{view:'orders/detail',id:order.id}}))||[]),
    ...(state?.customers.map(c=>({value:`customer:${c.id}`,label:`客户 · ${c.name}`,target:{view:'crm',id:c.id,customerId:c.id} as MistTarget}))||[]),
    ...(state?.market.suppliers.map(x=>({value:`supplier:${x.id}`,label:`供应商 · ${x.name}`,target:{view:'suppliers',id:x.id} as MistTarget}))||[]),
    ...(state?.market.quotations.map(q=>({value:`quotation:${q.id}`,label:`报价 · ${q.code}`,target:{view:'quotations',id:q.id,detail:'full'} as MistTarget}))||[]),
    ...(state?.fulfillment.shipments.filter(x=>x.state!=='cancelled').map(x=>({value:`shipment:${x.id}`,label:`出运 · ${x.code} · ${x.customer}`,target:{view:'shipments',id:x.id} as MistTarget}))||[]),
  ];
  const open = (event?: MistCalendarEvent) => {
    if(locked.current||activeEditing!==undefined||loading||saving||pending||!state)return;
    const targetKey=event?.target ? 'original' : '';
    const source=event?state?.calendar.find(e=>e.id===calendarSourceId(event.id))||event:undefined;
    setFormScope(scopeKey);setEditing(source?.id??null);setForm({title:source?.title||'',date:source?.date||selected,time:source?.time||'09:00',note:source?.note||'',targetKey});setOriginalTarget(source?.target);setPersonal(!!source?.ownerId);setExtra({participantIds:source?.participants?.map(p=>p.id)||[],remind:source?.remindMinutes?String(source.remindMinutes):'',repeat:source?.repeat?.every||'',until:source?.repeat?.until||''});setFailure('');
  };
  const link = (target:MistTarget) => go(target.view,target.id,target);
  const save = async () => {
    if(locked.current||!state||loading||saving||pending||formScope!==scopeKey)return;const invalid=calendarFormError(form);if(invalid){setFailure(invalid);return;}
    const target=form.targetKey==='original'?originalTarget:targets.find(choice=>choice.value===form.targetKey)?.target;
    if(form.targetKey&&form.targetKey!=='original'&&!target){setFailure('关联业务已不可用，请重新选择或取消关联');return;}
    const ticket=++sequence.current,owns=()=>live.current&&scope.current===scopeKey&&sequence.current===ticket;
    locked.current=true;setBusy(true);setFailure('');
    try {await run({type:'calendar.save',payload:{...(editing?{id:editing}:{}),title:form.title.trim(),date:form.date,time:form.time,note:form.note,...(target?{target}:{}),...(personal?{personal:true}:editing&&state?.calendar.find(e=>e.id===editing)?.ownerId?{personal:false}:{}),...calendarExtras(extra,editing?state?.calendar.find(e=>e.id===editing):undefined)}});if(owns()){setSelected(form.date);setEditing(undefined);toast(editing?'日程已更新':'日程已创建');}}
    catch(cause){if(owns())setFailure(cause instanceof Error?cause.message:'日程保存失败，请重试');}
    finally{if(owns()){locked.current=false;setBusy(false);}}
  };
  const retry = async () => {if(locked.current)return;const bound=scopeKey;setFailure('');try{await refresh();}catch(cause){if(live.current&&scope.current===bound)setFailure(String(cause));}};
  const resolve = async () => {if(locked.current||loading||saving)return;const original=pending,ticket=++sequence.current,owns=()=>live.current&&scope.current===scopeKey&&sequence.current===ticket;locked.current=true;setBusy(true);try{const receipt=await recover();if(receipt&&owns()){if(original?.command?.type==='calendar.save')setEditing(undefined);setFailure('');toast('原操作结果已核对');}}catch(cause){if(owns())setFailure(String(cause));}finally{if(owns()){locked.current=false;setBusy(false);}}};
  const recovery=pending?<Button loading={busy||saving} onClick={()=>void resolve()}>{uiText("核对原操作结果")}</Button>:null;
  return <MistPage>
    <PageHeader eyebrow={uiText("我的事务 · 日历")} title={uiText("日历")} actions={<Button variant={activeEditing===undefined?'primary':'quiet'} icon={Plus} disabled={!state||loading||saving||!!pending||busy||activeEditing!==undefined} onClick={()=>open()}>{uiText("新建日程")}</Button>} />
    <Toolbar right={<Button icon={RefreshCw} loading={loading} disabled={busy||saving} onClick={()=>void retry()}>{uiText("刷新")}</Button>}>
      <Button icon={ChevronLeft} aria-label={uiText("上一周")} onClick={()=>setSelected(date=>shiftDay(date,-7))}>{uiText("上一周")}</Button>
      <Button onClick={()=>setSelected(dayKey(businessNow()))}>{uiText("今天")}</Button>
      <Button iconRight={ChevronRight} aria-label={uiText("下一周")} onClick={()=>setSelected(date=>shiftDay(date,7))}>{uiText("下一周")}</Button>
      <Segmented ariaLabel={uiText('视图')} value={mode} onChange={v=>setMode(v as 'week'|'month')} options={[{value:'week',label:'周'},{value:'month',label:'月'}]} />
      <Checkbox label={uiText('只看我的')} checked={mineOnly} onChange={setMineOnly} />
    </Toolbar>
    {!pending&&(visibleFailure||error)&&<FailureNotice title={"日程操作未完成"} detail={visibleFailure||error} retry={()=>void retry()} retryLabel="重试读取" />}
    {pending&&!saving&&<div className="mist-section"><Banner tone="warn" title={uiText("原操作结果尚待核对")} actions={recovery}>{uiText("核对原请求后再继续保存。")}</Banner></div>}
    <Card>
      <CardHeader title={uiText(parseDay(selected).toLocaleDateString(interfaceLocale(),{year:'numeric',month:'long',day:'numeric',weekday:'long'}))} tools={<span className="mist-muted">{events.length}{uiText(" 项安排")}</span>} />
      {mode==='week'?<WeekStrip days={week} value={selected} onChange={setSelected} />:<MonthGrid selected={selected} counts={allEvents.reduce((m,e)=>m.set(e.date,(m.get(e.date)||0)+1),new Map<string,number>())} onPick={setSelected} />}
      {loading?<div className="mist-card-body"><Skeleton height={56} /><Skeleton height={56} /></div>:events.length?<Agenda events={events.map(event=>({time:event.time,title:isDerivedCalendarEvent(event)?<TextLink onClick={()=>event.target&&link(event.target)}>{event.title}</TextLink>:<TextLink disabled={activeEditing!==undefined||saving||!!pending} onClick={()=>open(event)}>{event.title}</TextLink>,meta:<><span>{event.note}</span>{event.target&&<TextLink iconRight={ArrowUpRight} onClick={()=>link(event.target!)}>{uiText("打开关联业务")}</TextLink>}</>}))} />:<EmptyState icon={CalendarDays} title={uiText("当天暂无日程")} action={<Button disabled={!state||loading||saving||!!pending||activeEditing!==undefined} onClick={()=>open()}>{uiText("添加日程")}</Button>} />}
    </Card>
    {activeEditing!==undefined&&<Card as="section" id="mist-calendar-editor" className="mist-section" aria-label={uiText(editing?'编辑日程':'新建日程')} data-calendar-editor>
      <CardHeader title={uiText(editing?'编辑日程':'新建日程')} sub={uiText("日程保存到本公司。")} />
      <form onSubmit={event=>{event.preventDefault();void save();}}><CardBody>
      {visibleFailure&&<Banner tone={pending?'warn':'bad'} title={uiText(pending?'保存结果待核对':'日程未保存')}>{pending?uiText('请先核对原请求，不要重复保存。'):visibleFailure}</Banner>}
      <fieldset disabled={busy||saving||!!pending} style={{border:0,padding:0,margin:0}}><FormGrid>
        <Field label={uiText("日程名称")} required full><TextInput aria-label={uiText("日程名称")} value={form.title} onChange={event=>setForm(previous=>({...previous,title:event.target.value}))} /></Field>
        <Field label={uiText("日期")} required><TextInput aria-label={uiText("日期")} type="date" value={form.date} onChange={event=>setForm(previous=>({...previous,date:event.target.value}))} /></Field>
        <Field label={uiText("时间")} required><TextInput aria-label={uiText("时间")} type="time" value={form.time} onChange={event=>setForm(previous=>({...previous,time:event.target.value}))} /></Field>
        <Field label={uiText("关联业务")} full><Select aria-label={uiText("关联业务")} value={form.targetKey} onChange={event=>setForm(previous=>({...previous,targetKey:event.target.value}))} options={[{value:'',label:'不关联业务'},...(form.targetKey==='original'?[{value:'original',label:'保留原业务关联'}]:[]),...targets.map(({value,label})=>({value,label}))]} /></Field>
        <Field label={uiText("安排说明")} full><TextArea aria-label={uiText("安排说明")} value={form.note} onChange={event=>setForm(previous=>({...previous,note:event.target.value}))} /></Field>
        <Field label={uiText("提醒")}><Select aria-label={uiText("提醒")} value={extra.remind} onChange={event=>setExtra(x=>({...x,remind:event.target.value}))} options={[{value:'',label:'不提醒'},{value:'15',label:'提前 15 分钟'},{value:'60',label:'提前 1 小时'},{value:'1440',label:'提前 1 天'}]} /></Field>
        <Field label={uiText("重复")}><Select aria-label={uiText("重复")} value={extra.repeat} onChange={event=>setExtra(x=>({...x,repeat:event.target.value as ''|'week'|'month'}))} options={[{value:'',label:'不重复'},{value:'week',label:'每周'},{value:'month',label:'每月'}]} /></Field>
        {extra.repeat&&<Field label={uiText("重复至")} required><TextInput aria-label={uiText("重复至")} type="date" value={extra.until} onChange={event=>setExtra(x=>({...x,until:event.target.value}))} /></Field>}
        {!!members.length&&<Field label={uiText("参与人")} full><div className="mist-row" style={{flexWrap:'wrap',gap:12}} role="group" aria-label={uiText("参与人")}>{members.map(m=><Checkbox key={m.id} label={m.name} checked={extra.participantIds.includes(m.id)} onChange={on=>setExtra(x=>({...x,participantIds:on?[...x.participantIds,m.id]:x.participantIds.filter(id=>id!==m.id)}))} />)}</div></Field>}
        <Checkbox label={uiText('仅本人与参与人可见')} checked={personal} onChange={setPersonal} />
      </FormGrid></fieldset>
      </CardBody><CardFooter>{recovery}<span className="mist-spacer" />{editing&&<Button variant="danger" disabled={busy||saving||!!pending} onClick={()=>{if(!editing)return;void (async()=>{locked.current=true;setBusy(true);try{await run({type:'calendar.delete',payload:{id:editing}});if(live.current){setEditing(undefined);toast('日程已删除');}}catch(cause){if(live.current)setFailure(cause instanceof Error?cause.message:'日程删除失败');}finally{locked.current=false;if(live.current)setBusy(false);}})();}}>{uiText('删除日程')}</Button>}<Button variant="quiet" disabled={busy} onClick={()=>setEditing(undefined)}>{uiText("取消")}</Button><Button type="submit" variant="primary" loading={busy} disabled={!state||loading||saving||!!pending}>{uiText("保存日程")}</Button></CardFooter></form>
    </Card>}
  </MistPage>;
}
