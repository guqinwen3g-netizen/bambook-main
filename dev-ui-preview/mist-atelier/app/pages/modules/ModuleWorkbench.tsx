import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** Shared T2/T3 lists and T4 editors. Domain pages own fields, transitions and authority. */
import React from 'react';
import { ArrowLeft, ArrowRight, Download, Edit3, Plus } from 'lucide-react';
import { FormFooter, BackLink, Banner, Button, Card, Checkbox, DataTable, Dialog, EmptyState, Field, FormGrid, FormSection, KeyValue, MistPage, Mono, PageHeader, Pagination, SearchField, Select, TextArea, TextInput, Toolbar, VerticalSteps, useToast, type Column } from '../../../../../components/mist';
import { useMistWorkspace,type MistWorkspaceContext,type MistCommandRecovery } from '../../runtime/workspace';
import {MistPresentedErrorContext} from '../../runtime/errorPresentation';
import { useNav } from '../../nav';
import { PreviewSummary, useCompactLayout, type PreviewSummaryData } from './pageKit';
import { IncotermPlaceInput, OptionInput } from '../OptionInput';
export type ModuleValue = string | number | boolean;
export type ModuleValues = Record<string, ModuleValue>;
type ModuleFieldCondition = {key:string;values:string[]};
export type ModuleField = {key:string;label:string;type?:'text'|'number'|'date'|'month'|'datetime-local'|'select'|'choice'|'incoterm'|'textarea'|'checkbox';options?:Array<{value:string;label:string}>;/** choice：常用选项 + 手动填写；strict 时只能选列表内的值。 */strict?:boolean;required?:boolean;hint?:string;readonly?:boolean;min?:number;step?:number|string;when?:ModuleFieldCondition|ModuleFieldCondition[]};
export type ModuleEditorSection = {id:string;label:string;description?:string;fields:string[]};
export type ModuleEditorSpec = {title:string;description?:string;sections?:ModuleEditorSection[];fields:ModuleField[];initialValues:ModuleValues;submit:(values:ModuleValues)=>Promise<unknown>;submitLabel?:string};
/** Domain-owned sections preserve the Mist T9 geometry without arbitrary six-field business boundaries.
 * Any unassigned fields remain visible in fallback sections; a partial declaration can never hide data. */
/** Applicability only: authorization and transaction constraints remain server-owned. */
export function moduleVisibleFields(spec:ModuleEditorSpec,values:ModuleValues=spec.initialValues){
  const current={...spec.initialValues,...values};return spec.fields.filter(field=>!field.when||(Array.isArray(field.when)?field.when:[field.when]).every(condition=>condition.values.includes(String(current[condition.key]??''))));
}
function applicableValues(spec:ModuleEditorSpec,values:ModuleValues){
  const result={...values},active=new Set(moduleVisibleFields(spec,values).map(field=>field.key));
  for(const field of spec.fields)if(!active.has(field.key))delete result[field.key];return result;
}
export function moduleEditorSections(spec:ModuleEditorSpec,values:ModuleValues=spec.initialValues){
  const visible=moduleVisibleFields(spec,values);
  const groups:Array<{id:string;label:string;description?:string;fields:ModuleField[]}>=[],used=new Set<string>();
  for(const section of spec.sections||[]){
    const fields=section.fields.flatMap(key=>{const field=visible.find(item=>item.key===key);if(!field||used.has(key))return[];used.add(key);return[field];});
    if(fields.length)groups.push({...section,fields});
  }
  const remaining=visible.filter(field=>!used.has(field.key));
  for(let i=0;i<remaining.length;i+=6)groups.push({id:'fallback-'+i,label:groups.length===0?'基本信息':groups.length===1?'业务信息':'补充信息',fields:remaining.slice(i,i+6)});
  groups.push({id:'review',label:'确认提交',fields:[]});
  return groups;
}
function selectValue(field:ModuleField,value:ModuleValue|undefined){const current=String(value??'');return field.options?.some(option=>option.value===current)?current:'';}
function selectError(field:ModuleField,value:ModuleValue|undefined){const current=String(value??'');return field.type==='select'&&current!==''&&!field.options?.some(option=>option.value===current)?'请重新选择'+field.label:'';}
/** A recovered acknowledgement belongs to one failed form submission, never to another open form. */
function useRecoveredModuleCommand(spec:ModuleEditorSpec|null,workspace:MistWorkspaceContext){
  const [attempt,setAttempt]=React.useState<{form:ModuleEditorSpec;key:Omit<MistCommandRecovery,'revision'>}|null>(null),[completedForm,setCompletedForm]=React.useState<ModuleEditorSpec|null>(null);
  React.useEffect(()=>{setAttempt(null);setCompletedForm(null);},[spec,workspace.workspace?.id]);
  const acknowledgement=workspace.commandRecovery;
  const matched=!!spec&&attempt?.form===spec&&!!acknowledgement&&attempt.key.requestId===acknowledgement.requestId&&attempt.key.workspaceId===acknowledgement.workspaceId&&attempt.key.actorId===acknowledgement.actorId&&workspace.workspace?.id===acknowledgement.workspaceId;
  React.useEffect(()=>{if(matched&&spec)setCompletedForm(spec);},[matched,spec]);
  const failed=(problem:unknown)=>{
    const key=problem&&typeof problem==='object'?(problem as {mistPendingCommand?:Partial<MistCommandRecovery>}).mistPendingCommand:undefined;
    if(spec&&key&&typeof key.requestId==='string'&&typeof key.workspaceId==='string'&&typeof key.actorId==='string')setAttempt({form:spec,key:{requestId:key.requestId,workspaceId:key.workspaceId,actorId:key.actorId}});
  };
  // Derive immediately as well as latch, so clearing pending cannot briefly re-enable Save.
  return {completed:!!spec&&(matched||completedForm===spec&&attempt?.key.workspaceId===workspace.workspace?.id&&attempt?.key.actorId===acknowledgement?.actorId),failed};
}
export function ModuleEditorDialog({spec,onClose,onSaved}:{spec:ModuleEditorSpec|null;onClose:()=>void;onSaved?:()=>void}){
  const workspace=useMistWorkspace(),{saving,pending,pendingCreate}=workspace,toast=useToast(),recovery=useRecoveredModuleCommand(spec,workspace);
  const [values,setValues]=React.useState<ModuleValues>({}),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
  const mounted=React.useRef(true),lock=React.useRef(false),generation=React.useRef(0);
  React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  React.useEffect(()=>{generation.current++;setValues(spec?{...spec.initialValues}:{});setError('');setBusy(false);lock.current=false;},[spec]);
  const visible=spec?moduleVisibleFields(spec,values):[];
  const disabled=busy||saving||!!pending||!!pendingCreate||recovery.completed;
  const submit=async()=>{
    if(!spec||disabled||lock.current)return;
    for(const f of visible){if(f.required&&(values[f.key]===undefined||String(values[f.key]).trim()==='')){setError('请填写'+f.label);return;}const invalid=selectError(f,values[f.key]);if(invalid){setError(invalid);return;}}
    const converted=applicableValues(spec,values);for(const f of visible)if(f.type==='number'){
      if(converted[f.key]===''&&!f.required)continue; const n=Number(converted[f.key]);
      if(!Number.isFinite(n)||(f.min!==undefined&&n<f.min)){setError(f.label+'无效');return;}converted[f.key]=n;
    }
    const run=++generation.current;lock.current=true;setBusy(true);setError('');
    try{await spec.submit(converted);if(mounted.current&&run===generation.current){onSaved?.();onClose();toast('已保存');}}
    catch(problem){if(mounted.current&&run===generation.current){recovery.failed(problem);setError(problem instanceof Error?problem.message:'保存未完成，请重试');}}
    finally{if(mounted.current&&run===generation.current){lock.current=false;setBusy(false);}}
  };
  const change=(key:string,value:ModuleValue)=>setValues(v=>({...v,[key]:value}));
  return <Dialog open={!!spec} title={uiText(spec?.title||'编辑')} onClose={()=>{if(!busy)onClose();}} width={760}
    footer={<><Button disabled={busy} onClick={onClose}>{uiText(recovery.completed?"关闭":"取消")}</Button>{recovery.completed?<Button variant="primary" onClick={onClose}>{uiText("查看记录")}</Button>:<Button variant="primary" loading={busy} disabled={disabled} onClick={()=>void submit()}>{spec?.submitLabel||'保存'}</Button>}</>}>
    {spec?.description&&<p className="mist-sub" style={{margin:'0 0 12px'}}>{uiText(spec.description)}</p>}
    {recovery.completed?<Banner tone="ok" title={uiText("原操作已保存")}/>:error&&<Banner tone="bad" title={uiText("未能保存")}>{uiText(error)}</Banner>}
    {(pending||pendingCreate)&&!saving&&<Banner tone="warn" title={uiText("请先核对上次操作的结果")}>{uiText("输入会保留；使用页面上的原请求核对入口后继续。")}</Banner>}
    <FormGrid>{visible.map(f=><Field key={f.key} label={f.type==='checkbox'?undefined:uiText(f.label)} required={f.required} hint={uiText(f.hint)} full={f.type==='textarea'}>
      {f.type==='choice'?<OptionInput ariaLabel={f.label} options={f.options||[]} strict={f.strict} value={String(values[f.key]??'')} disabled={disabled||f.readonly} onChange={v=>change(f.key,v)} />
      :f.type==='incoterm'?<IncotermPlaceInput ariaLabel={f.label} value={String(values[f.key]??'')} disabled={disabled||f.readonly} onChange={v=>change(f.key,v)} />
      :f.type==='select'?<Select aria-label={uiText(f.label)} placeholder={uiText(f.options?.some(option=>option.value==='')?undefined:'请选择')} value={selectValue(f,values[f.key])} options={f.options||[]} disabled={disabled||f.readonly} onChange={e=>change(f.key,e.target.value)} />
      :f.type==='textarea'?<TextArea aria-label={uiText(f.label)} value={String(values[f.key]??'')} disabled={disabled||f.readonly} onChange={e=>change(f.key,e.target.value)} />
      :f.type==='checkbox'?<Checkbox label={uiText(f.label)} checked={!!values[f.key]} disabled={disabled||f.readonly} onChange={v=>change(f.key,v)} />
      :<TextInput aria-label={uiText(f.label)} type={f.type||'text'} min={f.min} step={f.step} value={String(values[f.key]??'')} disabled={disabled||f.readonly} onChange={e=>change(f.key,e.target.value)} />}
    </Field>)}</FormGrid>
  </Dialog>;
}
export type ModuleRowAction<T>={label:string;run:(row:T)=>Promise<unknown>|void;disabled?:(row:T)=>boolean};
/** T2 quick preview: only what is needed to recognise the record and decide whether to open it.
 * Long sections (tables, attachments, history) belong to the full detail page, never to the 340px column. */
export type ModulePreviewSummary=PreviewSummaryData;
export type ModuleWorkbenchProps<T extends {id:string}>={title:string;eyebrow?:string;description?:string;rows:T[];columns:Column<NoInfer<T>>[];searchText?:(row:NoInfer<T>)=>string;rowKey?:(row:NoInfer<T>)=>string;exportRows?:(filtered:NoInfer<T>[])=>void;create?:ModuleEditorSpec;edit?:(row:NoInfer<T>)=>ModuleEditorSpec|undefined;detail?:(row:NoInfer<T>)=>React.ReactNode;detailSurface?:'card'|'sections';rowActions?:ModuleRowAction<NoInfer<T>>[];toolbar?:React.ReactNode;preview?:boolean;summary?:(row:NoInfer<T>)=>ModulePreviewSummary;openLabel?:string;showWorkspaceError?:boolean};
export function ModuleWorkbench<T extends {id:string}>({title,eyebrow,description,rows,columns,searchText,rowKey,exportRows,create,edit,detail,detailSurface='card',rowActions=[],toolbar,preview,summary,openLabel='打开完整详情',showWorkspaceError=true}:ModuleWorkbenchProps<T>){
  const workspace=useMistWorkspace(),toast=useToast(),{route,go}=useNav(),compact=useCompactLayout();
  const presentedError=React.useContext(MistPresentedErrorContext);
  const [query,setQuery]=React.useState(''),[page,setPage]=React.useState(1),[selected,setSelected]=React.useState<string|null>(route.id||null),[editor,setEditor]=React.useState<ModuleEditorSpec|null>(null),[failure,setFailure]=React.useState(''),[acting,setActing]=React.useState(false);
  const actionLock=React.useRef(false);
  React.useEffect(()=>{setSelected(route.id||null);setFailure('');},[route.id]);
  const routeContext=JSON.stringify(route);
  React.useEffect(()=>{setEditor(null);},[routeContext]);
  const selectionKey=route.id??selected;
  const active=React.useRef(true),currentContext=React.useRef(routeContext),currentSelection=React.useRef(selectionKey);
  currentContext.current=routeContext;currentSelection.current=selectionKey;
  React.useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const getKey=rowKey||((r:T)=>r.id),size=12;
  const filtered=rows.filter(r=>!query||(searchText?searchText(r):Object.values(r).filter(v=>typeof v==='string'||typeof v==='number').join(' ')).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pages=Math.max(1,Math.ceil(filtered.length/size)),visiblePage=Math.min(page,pages),current=rows.find(r=>getKey(r)===selectionKey)||null;
  const locked=acting||workspace.saving||!!workspace.pending||!!workspace.pendingCreate;
  const act=async(action:ModuleRowAction<T>,row:T)=>{if(locked||actionLock.current)return;const origin=routeContext,rowId=getKey(row);actionLock.current=true;setActing(true);setFailure('');try{await action.run(row);}catch(problem){if(active.current&&currentContext.current===origin&&currentSelection.current===rowId)setFailure(problem instanceof Error?problem.message:'操作未完成');}finally{actionLock.current=false;if(active.current)setActing(false);}};
  const editSpec=current?edit?.(current):undefined;
  const controls=current&&(editSpec||rowActions.length)?<div className="mist-row mist-module-actions">{editSpec&&<Button icon={Edit3} disabled={locked} onClick={()=>setEditor(editSpec)}>{uiText("编辑")}</Button>}{rowActions.map(a=><Button key={a.label} disabled={locked||a.disabled?.(current)} onClick={()=>void act(a,current)}>{uiText(a.label)}</Button>)}</div>:null;
  const recordDetail=current?detail?.(current):<EmptyState title={uiText(workspace.loading?'正在读取记录':selectionKey?'未找到这条记录':'选择一条记录')} compact />;
  const body=<div className="mist-col" data-module-detail>{controls}{recordDetail}</div>;
  const previewSummary=preview&&current&&summary?summary(current):null;
  // Compact layouts hide the preview column, so a selected record opens as its full page instead.
  const fullDetail=!!route.id&&(!preview||compact||route.detail==='full');
  const returnToList=()=>{const {view,id,detail:detailMode,...target}=route;setSelected(null);setFailure('');go(view,undefined,target);};
  const openFullDetail=()=>{if(current){const {view,id,...target}=route;go(view,getKey(current),{...target,detail:'full'});}};
  const publicCode=current?Object.entries(current).find(([key,value])=>['code','number','sku'].includes(key)&&typeof value==='string'&&value.trim())?.[1]:undefined;
  const publicName=current?Object.entries(current).find(([key,value])=>['name','title'].includes(key)&&typeof value==='string'&&value.trim())?.[1]:undefined;
  if(editor&&editor.fields.length>3)return <ModuleEditorPage spec={editor} onClose={()=>setEditor(null)} />;
  if(fullDetail)return <MistPage>
    <BackLink onClick={returnToList}>{uiText("返回")}{uiText(title)}</BackLink>
    <PageHeader description={uiText(publicName?String(publicName):undefined)} eyebrow={publicCode?<Mono>{String(publicCode)}</Mono>:eyebrow} title={uiText(title+'详情')} actions={controls}/>
    {failure&&!workspace.error?.startsWith(failure)&&<div className="mist-section"><Banner tone="bad" title={uiText("操作未完成")}>{failure}</Banner></div>}
    {showWorkspaceError&&workspace.error&&workspace.error!==presentedError&&<div className="mist-section"><Banner tone="bad" title={uiText(workspace.error)} actions={<Button onClick={()=>void workspace.refresh()}>{uiText("重新读取")}</Button>}/></div>}
    {detailSurface==='sections'&&current?<div className="mist-col" data-module-detail data-detail-surface="sections">{recordDetail}</div>:<Card><div className="mist-card-body mist-col" data-module-detail>{recordDetail}</div></Card>}
    <ModuleEditorDialog spec={editor} onClose={()=>setEditor(null)}/>
  </MistPage>;
  return <MistPage><PageHeader  eyebrow={uiText(eyebrow)} title={uiText(title)} actions={<>{exportRows&&<Button icon={Download} onClick={()=>exportRows(filtered)}>{uiText("导出")}</Button>}{create&&<Button variant="primary" icon={Plus} disabled={locked} onClick={()=>setEditor(create)}>{uiText("新建")}</Button>}</>} />
    {failure&&!workspace.error?.startsWith(failure)&&<Banner tone="bad" title={uiText("操作未完成")}>{failure}</Banner>}
    {showWorkspaceError&&workspace.error&&workspace.error!==presentedError&&<Banner tone="bad" title={uiText(workspace.error)} actions={<Button onClick={()=>void workspace.refresh()}>{uiText("重新读取")}</Button>} />}
    <Toolbar right={toolbar}><SearchField value={query} onChange={v=>{setQuery(v);setPage(1);}} placeholder={uiText('搜索'+title)} /></Toolbar>
    <section className={preview?'mist-split':'mist-grid'} data-preview-summary={preview?'':undefined}><Card className={preview?undefined:'mist-col-12'}><DataTable loading={workspace.loading} rows={filtered.slice((visiblePage-1)*size,visiblePage*size)} columns={columns} rowKey={getKey} selectedKey={selectionKey} onRowClick={r=>{setSelected(getKey(r));const {view,id,detail:detailMode,...target}=route;if(preview&&!compact)go(view,getKey(r),target,{keepScroll:true});else go(view,getKey(r),target);}} ariaLabel={uiText(title)} empty={<EmptyState title={uiText(query?'没有匹配的记录':'还没有'+title+(title.endsWith('记录')?'':'记录'))} action={!query&&create?<Button onClick={()=>setEditor(create)}>{uiText("新建")}</Button>:undefined} />} footer={<div className="mist-row"><span className="mist-note">{filtered.length}{uiText(" 条记录")}</span><span className="mist-spacer"/><Pagination page={visiblePage} pages={pages} onChange={setPage}/></div>} /></Card>
      {preview&&!compact&&<Card as="aside" className="mist-preview" aria-label={uiText("记录预览")}>{current&&previewSummary?<PreviewSummary data={previewSummary} actions={controls} openLabel={openLabel} onOpen={openFullDetail} data-module-detail=""/>
      :<div className="mist-preview-b">{body}{current&&<Button variant="primary" block iconRight={ArrowRight} onClick={openFullDetail}>{openLabel}</Button>}</div>}</Card>}</section>
    <ModuleEditorDialog spec={editor} onClose={()=>setEditor(null)} />
  </MistPage>;
}
/** Explicit field rows only; no internal identifiers or raw JSON are exported by default. */
export function downloadModuleCsv(filename:string,headers:string[],rows:Array<Array<unknown>>){
  const cell=(input:unknown)=>{let value=input==null?'':String(input);if(/^[=+@\t\r]/.test(value)||(/^-/ .test(value)&&!/^-[\d.]+$/.test(value)))value="'"+value;return '"'+value.replace(/"/g,'""')+'"';};
  const data='\uFEFF'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function ModuleEditorPage({spec,onClose}:{spec:ModuleEditorSpec;onClose:()=>void}){
  const presentedError=React.useContext(MistPresentedErrorContext);
  const workspace=useMistWorkspace(),toast=useToast(),recovery=useRecoveredModuleCommand(spec,workspace);
  const [values,setValues]=React.useState<ModuleValues>({...spec.initialValues}),[step,setStep]=React.useState(0),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
  const live=React.useRef(true),lock=React.useRef(false);React.useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const visible=moduleVisibleFields(spec,values),groups=moduleEditorSections(spec,values),shownStep=Math.min(step,groups.length-1);
  React.useEffect(()=>{setStep(previous=>Math.min(previous,groups.length-1));},[groups.length]);
  const current=groups[shownStep],last=shownStep===groups.length-1,blocked=busy||workspace.saving||!!workspace.pending||!!workspace.pendingCreate||recovery.completed;
  const validate=(fields:ModuleField[])=>{for(const f of fields){if(f.required&&(values[f.key]===undefined||String(values[f.key]).trim()===''))return '请填写'+f.label;const invalid=selectError(f,values[f.key]);if(invalid)return invalid;if(f.type==='number'&&values[f.key]!==''&&values[f.key]!==undefined&&(!Number.isFinite(Number(values[f.key]))||(f.min!==undefined&&Number(values[f.key])<f.min)))return f.label+'无效';}return '';};
  const save=async()=>{if(blocked||lock.current)return;const problem=validate(visible);if(problem){setError(problem);return;}lock.current=true;setBusy(true);const converted=applicableValues(spec,values);for(const f of visible)if(f.type==='number'&&values[f.key]!==''&&values[f.key]!==undefined)converted[f.key]=Number(values[f.key]);try{await spec.submit(converted);if(live.current){onClose();toast('已保存');}}catch(e){if(live.current){recovery.failed(e);setError(e instanceof Error?e.message:'保存未完成');}}finally{if(live.current){lock.current=false;setBusy(false);}}};
  const set=(key:string,v:ModuleValue)=>{setValues(old=>({...old,[key]:v}));setError('');};
  return <MistPage><BackLink onClick={onClose}>{uiText("返回列表")}</BackLink><PageHeader  title={uiText(spec.title)}/>{recovery.completed?<Banner tone="ok" title={uiText("原操作已保存")}/>:error&&presentedError!==error&&<Banner tone="bad" title={uiText("未能保存")}>{uiText(error)}</Banner>}<div className="mist-wizard"><VerticalSteps current={String(shownStep)} onSelect={id=>{const target=Number(id);if(target<=step){setStep(target);setError('');}}} steps={groups.map((g,i)=>({id:String(i),label:g.label,done:i<step}))}/><Card>
    <FormSection title={uiText(current.label)}>{last?<KeyValue items={visible.map(f=>({label:f.label,value:f.type==='checkbox'?(values[f.key]?'是':'否'):f.type==='select'||f.type==='choice'?(f.options?.find(o=>o.value===values[f.key])?.label||String(values[f.key]??'—')):String(values[f.key]??'—')}))}/>:<FormGrid>{current.fields.map(f=><Field key={f.key} label={f.type==='checkbox'?undefined:uiText(f.label)} required={f.required} hint={uiText(f.hint)} full={f.type==='textarea'}>{f.type==='choice'?<OptionInput ariaLabel={f.label} options={f.options||[]} strict={f.strict} value={String(values[f.key]??'')} disabled={blocked||f.readonly} onChange={v=>set(f.key,v)}/>:f.type==='incoterm'?<IncotermPlaceInput ariaLabel={f.label} value={String(values[f.key]??'')} disabled={blocked||f.readonly} onChange={v=>set(f.key,v)}/>:f.type==='select'?<Select aria-label={uiText(f.label)} placeholder={uiText(f.options?.some(option=>option.value==='')?undefined:'请选择')} value={selectValue(f,values[f.key])} options={f.options||[]} disabled={blocked||f.readonly} onChange={e=>set(f.key,e.target.value)}/>:f.type==='textarea'?<TextArea aria-label={uiText(f.label)} value={String(values[f.key]??'')} disabled={blocked||f.readonly} onChange={e=>set(f.key,e.target.value)}/>:f.type==='checkbox'?<Checkbox label={uiText(f.label)} checked={!!values[f.key]} disabled={blocked||f.readonly} onChange={v=>set(f.key,v)}/>:<TextInput aria-label={uiText(f.label)} type={f.type||'text'} min={f.min} step={f.step} value={String(values[f.key]??'')} disabled={blocked||f.readonly} onChange={e=>set(f.key,e.target.value)}/>}</Field>)}</FormGrid>}</FormSection>
    <FormFooter><span className="mist-note">{uiText("第 ")}{uiText(shownStep+1)} / {groups.length}{uiText(" 步")}</span><span className="mist-spacer"/>{step>0&&<Button icon={ArrowLeft} disabled={blocked} onClick={()=>{setStep(i=>i-1);setError('');}}>{uiText("上一步")}</Button>}{recovery.completed?<Button variant="primary" onClick={onClose}>{uiText("查看记录")}</Button>:last?<Button variant="primary" loading={busy} disabled={blocked} onClick={()=>void save()}>{spec.submitLabel||'确认保存'}</Button>:<Button variant="primary" iconRight={ArrowRight} disabled={blocked} onClick={()=>{const problem=validate(current.fields);if(problem)setError(problem);else setStep(i=>i+1);}}>{uiText("下一步")}</Button>}</FormFooter>
  </Card></div></MistPage>;
}
