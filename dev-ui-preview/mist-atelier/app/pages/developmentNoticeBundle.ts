import type {MistFile} from '../../../../server/src/shared/mistWorkspace';
import type {DevNoticeRecord} from '../../../../server/src/shared/mistDevelopmentNotice';

import {workspaceFileBundle} from '../runtime/workspaceFileBundle';

/** Read only this notice's frozen references through the current workspace's authenticated reader. */
export async function developmentNoticeBundle(notice:Pick<DevNoticeRecord,'fileId'|'noticeNo'|'generatedAt'>&{snapshot:Pick<DevNoticeRecord['snapshot'],'attachments'>},files:MistFile[],readFile:(file:MistFile)=>Promise<Blob>,isCurrent:()=>boolean=()=>true){
 const staleMessage='页面已切换，请重新下载';
 if(!isCurrent())throw new Error(staleMessage);
 const refs=notice.snapshot.attachments.filter(ref=>ref.fileId!==notice.fileId);
 if(!refs.length)throw new Error('本通知单没有附件');
 return workspaceFileBundle(refs,files,readFile,{name:notice.noticeNo+'-附件包',date:notice.generatedAt,isCurrent,staleMessage});
}
