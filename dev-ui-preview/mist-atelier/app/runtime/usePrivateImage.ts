import React from 'react';
import { apiService } from '../../../../services/apiService';
import { useMistSession } from './auth';

type Entry = { promise: Promise<string>; controller: AbortController; url?: string; users: number; timer?: ReturnType<typeof setTimeout> };
const images = new Map<string, Entry>();
let currentScope = '';
function remove(key: string, entry: Entry) {
  if(images.get(key)!==entry)return;
  images.delete(key); if(entry.timer)clearTimeout(entry.timer);
  entry.controller.abort(); if(entry.url)URL.revokeObjectURL(entry.url);
}
/** Short-lived memory reuse only. Account/company changes discard every private blob. */
export function usePrivateImageResource(path: string | undefined) {
  const session = useMistSession();
  const scope = `${session.sessionKey}:${session.user?.id || ''}`;
  const key = `${scope}:${path || ''}`;
  const [image, setImage] = React.useState<{ key: string; url: string }>();
  const [failure,setFailure]=React.useState<string>();
  const [attempt,setAttempt]=React.useState(0);
  React.useEffect(() => {
    if(currentScope!==scope){for(const [oldKey,entry] of images)remove(oldKey,entry);currentScope=scope;}
    if (!path) return;
    setFailure(undefined);
    let active = true;
    let entry = images.get(key);
    if(!entry){
      const controller=new AbortController();
      entry={controller,users:0,promise:Promise.resolve('')};
      const created=entry;
      entry.promise=fetch(path,{headers:apiService.getAuthHeaders(),credentials:'include',signal:controller.signal})
        .then(response=>{if(!response.ok)throw new Error('图片读取失败');return response.blob();})
        .then(blob=>{if(controller.signal.aborted)throw new Error('图片读取已取消');return created.url=URL.createObjectURL(blob);});
      images.set(key,entry);
    }
    if(entry.timer)clearTimeout(entry.timer);
    entry.users++;
    const acquired=entry;
    void entry.promise.then(url=>{if(active)setImage({key,url});}).catch(()=>{remove(key,acquired);if(active){setImage(undefined);setFailure(key);}});
    return ()=>{
      active=false;acquired.users--;
      if(!acquired.users){
        if(!acquired.url)remove(key,acquired);
        else acquired.timer=setTimeout(()=>remove(key,acquired),60_000);
      }
    };
  }, [key, path, scope, attempt]);
  return {src: image?.key === key ? image.url : undefined, failed:failure===key, retry:()=>setAttempt(value=>value+1)};
}

export function usePrivateImage(path: string | undefined): string | undefined { return usePrivateImageResource(path).src; }
