import type {MistFile} from '../../../../server/src/shared/mistWorkspace';
import type {DevNoticeRecord} from '../../../../server/src/shared/mistDevelopmentNotice';

const MAX_BUNDLE_BYTES=200*1024*1024;
const safeName=(name:string)=>{
 const leaf=name.replace(/\\/g,'/').split('/').pop()?.replace(/[\x00-\x1f\x7f<>:"|?*]/g,'_').trim();
 const value=!leaf||leaf==='.'||leaf==='..'?'附件':leaf;
 return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)?'_'+value:value;
};
/** Read only this notice's frozen references through the current workspace's authenticated reader. */
export async function developmentNoticeBundle(notice:DevNoticeRecord,files:MistFile[],readFile:(file:MistFile)=>Promise<Blob>,isCurrent:()=>boolean=()=>true){
 const check=()=>{if(!isCurrent())throw new Error('页面已切换，请重新下载');};check();
 const seen=new Set<string>(),refs=notice.snapshot.attachments.filter(ref=>ref.fileId!==notice.fileId&&!seen.has(ref.fileId)&&!!seen.add(ref.fileId));
 if(!refs.length)throw new Error('本通知单没有附件');
 const selected=refs.map(ref=>{const file=files.find(file=>file.id===ref.fileId);if(!file)throw new Error(`附件不可用或无权读取：${ref.name}`);return{ref,file};});
 if(selected.some(({file})=>!Number.isSafeInteger(file.size)||file.size<0))throw new Error('附件大小待核对');
 if(selected.reduce((total,{file})=>total+file.size,0)>MAX_BUNDLE_BYTES)throw new Error('附件超过200MB，请分别下载');
 const JSZip=(await import('jszip')).default,zip=new JSZip(),names=new Set<string>();
 for(const {ref,file} of selected){
  check();const blob=await readFile(file);check();if(blob.size!==file.size)throw new Error(`附件原件大小不符：${ref.name}`);
  const base=safeName(ref.name),dot=base.lastIndexOf('.'),stem=dot>0?base.slice(0,dot):base,extension=dot>0?base.slice(dot):'';
  let name=base,index=2;while(names.has(name.toLowerCase()))name=`${stem} (${index++})${extension}`;names.add(name.toLowerCase());
  zip.file(name,new Uint8Array(await blob.arrayBuffer()),{date:new Date(notice.generatedAt),createFolders:false});
 }
 check();const bytes=await zip.generateAsync({type:'uint8array',compression:'STORE'});check();
 return{name:safeName(notice.noticeNo)+'-附件包.zip',bytes};
}
