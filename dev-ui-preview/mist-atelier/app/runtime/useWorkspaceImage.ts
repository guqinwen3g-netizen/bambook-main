import type { MistFile } from '../../../../server/src/shared/mistWorkspace';
import { usePrivateImageResourceForScope } from './usePrivateImage';
import { useMistWorkspace } from './workspace';
import { useOptionalMistSession } from './auth';

export type WorkspaceImageMode = 'thumb'|'display'|'cutout-thumb'|'cutout-display';
export function firstWorkspaceImage(files:MistFile[],ids:string[]|undefined){return (ids??[]).map(id=>files.find(file=>file.id===id)).find(file=>file?.mimeType.startsWith('image/'));}
export function useWorkspaceImage(file:MistFile|undefined,mode:WorkspaceImageMode='cutout-display'){
 const workspace=useMistWorkspace(),session=useOptionalMistSession();let path:string|undefined;
 if(file&&!workspace.loading){try{path=workspace.fileUrl(file)+'?preview='+mode;}catch{/* The changing workspace must not expose its previous image. */}}
 const workspaceId=workspace.workspace?.id??'';
 return usePrivateImageResourceForScope(path,session?`${session.sessionKey}:${session.user?.id||''}:${workspaceId}`:`test:${workspaceId}`);
}
