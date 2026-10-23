import { uiText, ui } from '../../../../services/interfaceLanguage';
/** BB-DEV-4：本版（本轮本厂）试样通知单——生成、重新生成（旧版保留）、下载、打印。不记录发送状态。 */
import React from 'react';
import { Download, FileText, Printer, RefreshCw } from 'lucide-react';
import { Banner, Button, Card, CardHeader, Mono, Pill } from '../../../../components/mist';
import type { MistDev, MistState, MistVersion } from '../../../../server/src/shared/mistWorkspace';
import { developmentNoticeBlocker, developmentNoticeOutdated, developmentNotices, developmentNoticeTitle, developmentNoticeTime } from '../../../../server/src/shared/mistDevelopmentNotice';
import {useMistWorkspace} from '../runtime/workspace';
import {useOptionalMistSession} from '../runtime/auth';
import {useRouteScope} from './modules/useRouteDraft';
import {developmentNoticeBundle} from './developmentNoticeBundle';
import type {DevNoticeRecord} from '../../../../server/src/shared/mistDevelopmentNotice';
import { developmentDomain } from '../../../../server/src/shared/mistDevelopmentDomain';
import { PreviewButton } from '../runtime/files';

export function DevNoticeCard({ state, dev, version, busy, onGenerate, onDownload, onPrint }: {
  state: MistState; dev: MistDev; version: MistVersion; busy: boolean;
  onGenerate: () => void; onDownload: (fileId: string) => void; onPrint: (fileId: string) => void;
}) {
  const workspace=useMistWorkspace(),session=useOptionalMistSession(),routeScope=useRouteScope();
  const key=`${workspace.workspace?.id||''}:${session?.sessionKey||''}:${dev.id}:${version.id}`,context=React.useRef(key),live=React.useRef(true),lock=React.useRef<symbol|null>(null);
  context.current=key;
  const [packaging,setPackaging]=React.useState(''),[failure,setFailure]=React.useState('');
  React.useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  React.useEffect(()=>{lock.current=null;setPackaging('');setFailure('');},[key]);
  const downloadBundle=async(notice:DevNoticeRecord)=>{
    if(busy||lock.current)return;const token=Symbol();lock.current=token;setPackaging(notice.id);setFailure('');
    const current=()=>live.current&&context.current===key&&routeScope.isCurrent();
    try{
      if(!workspace.readFile)throw new Error('当前不能读取附件原件');
      const result=await developmentNoticeBundle(notice,state.files,workspace.readFile,current);if(!current())return;
      const url=URL.createObjectURL(new Blob([new Uint8Array(result.bytes).buffer],{type:'application/zip'})),anchor=document.createElement('a');anchor.href=url;anchor.download=result.name;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch(error){if(current())setFailure(error instanceof Error?error.message:'附件包下载失败');}
    finally{if(lock.current===token)lock.current=null;if(current())setPackaging('');}
  };
  const title = developmentNoticeTitle(developmentDomain(dev.values)), notices = developmentNotices(version);
  const blocker = developmentNoticeBlocker(state, dev, version), outdated = developmentNoticeOutdated(state, dev, version);
  return <Card id="mist-dev-notice">
    {failure&&<Banner tone="bad" title={uiText("附件包下载失败")}>{uiText(failure)}</Banner>}
    <CardHeader title={uiText(title)} sub={ui`${version.label} · ${version.factory}`} tools={<Button size="sm" icon={notices.length ? RefreshCw : FileText} disabled={busy || !!blocker} title={uiText(blocker || undefined)} onClick={onGenerate}>{uiText(notices.length ? '重新生成' : '生成通知单')}</Button>} />
    {(blocker || outdated) && <div className="mist-row" style={{ padding: '0 22px 8px', gap: 8, flexWrap: 'wrap' }}>
      {outdated && <Pill tone="warn">{uiText("工厂任务已更新，可重新生成")}</Pill>}{blocker && <span className="mist-note">{blocker}</span>}</div>}
    <div role="list" aria-label={uiText(`${version.label} ${title}`)} style={{ padding: '0 22px 14px' }}>
      {notices.length ? notices.map((notice, index) => <div key={notice.id} role="listitem" className="mist-row" data-notice={notice.noticeNo} style={{ gap: 8, flexWrap: 'wrap', padding: '8px 0' }}>
        <Pill tone={index === 0 ? (outdated ? 'warn' : 'ok') : 'neutral'}>{uiText(index === 0 ? '最新' : '旧版')}</Pill>
        <span className="mist-col" style={{ gap: 0, minWidth: 0 }}><Mono>{notice.noticeNo}</Mono><small className="mist-muted">{notice.generatedBy} · {developmentNoticeTime(notice.generatedAt)}{uiText(" · 要求 ")}{notice.snapshot.dueDate}</small></span>
        <span className="mist-spacer" />
        <PreviewButton file={state.files.find(f => f.id === notice.fileId)} disabled={busy} />
        <Button size="sm" variant="quiet" icon={Download} disabled={busy} onClick={() => onDownload(notice.fileId)}>{uiText("通知单")}</Button>
        <Button size="sm" variant="quiet" icon={Download} loading={packaging===notice.id} disabled={busy||!!packaging||!notice.snapshot.attachments.some(ref=>ref.fileId!==notice.fileId)} title={notice.snapshot.attachments.length?undefined:uiText("本通知单没有附件")} onClick={()=>void downloadBundle(notice)}>{uiText("附件包 (zip)")}</Button>
        <Button size="sm" variant="quiet" icon={Printer} disabled={busy} onClick={() => onPrint(notice.fileId)}>{uiText("打印")}</Button>
      </div>) : <span className="mist-note">{uiText("尚未生成")}</span>}
    </div>
  </Card>;
}
