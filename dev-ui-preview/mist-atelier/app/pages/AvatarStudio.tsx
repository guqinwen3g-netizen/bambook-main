import React from 'react';
import { ImageUp, RotateCw, Undo2 } from 'lucide-react';
import { Avatar, Banner, Button, Dialog, Icon, Tabs, useToast } from '../../../../components/mist';
import { updateMyProfile } from '../../../../services/authService';
import { uiText } from '../../../../services/interfaceLanguage';
import { defaultAvatarColor, initialsIdentity, parseAvatarIdentity, parseInitialsIdentity, parsePersonIdentity, patternColorFromIdentity, type AvatarColor } from '../../../../lib/avatarIdentity';
import { useMistSession } from '../runtime/auth';
import { InitialsChoices } from './AvatarChoices';
import { AvatarExplorer } from './AvatarExplorer';
const MAX_AVATAR_CHARS=700_000, CROP_PREVIEW=256, CROP_OUTPUT=256;
type Mode='initials'|'pattern'|'photo';
const modeOf=(value?:string|null):Mode=>parsePersonIdentity(value)?'pattern':parseAvatarIdentity(value)?'pattern':!value||parseInitialsIdentity(value)?'initials':'photo';
type CropDraft = { src: string; width: number; height: number; scale: number; rotation: number; offset: { x: number; y: number } };
const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new window.Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('图片格式无法识别')); img.src = src; });
const readFile = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('读取头像失败')); reader.onload = () => resolve(String(reader.result || '')); reader.readAsDataURL(file); });
function rotatedSize(d: CropDraft) { return d.rotation % 180 === 0 ? [d.width, d.height] : [d.height, d.width]; }
/** 输出 256px 圆形 webp；偏移量按预览尺寸换算。 */
export async function renderCircularAvatar(d: CropDraft): Promise<string> {
  const img = await loadImage(d.src);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = CROP_OUTPUT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持头像裁切');
  const [rw, rh] = rotatedSize(d), base = CROP_OUTPUT / Math.min(rw, rh), k = CROP_OUTPUT / CROP_PREVIEW;
  ctx.beginPath(); ctx.arc(CROP_OUTPUT / 2, CROP_OUTPUT / 2, CROP_OUTPUT / 2, 0, Math.PI * 2); ctx.clip();
  ctx.translate(CROP_OUTPUT / 2 + d.offset.x * k, CROP_OUTPUT / 2 + d.offset.y * k);
  ctx.rotate(d.rotation * Math.PI / 180);
  ctx.drawImage(img, -d.width * base * d.scale / 2, -d.height * base * d.scale / 2, d.width * base * d.scale, d.height * base * d.scale);
  return canvas.toDataURL('image/webp', .86);
}

function explain(error:unknown,fallback:string) { return error instanceof Error ? error.message : fallback; }
function clampCrop(d:CropDraft,offset=d.offset) {
  const [w,h]=rotatedSize(d),base=CROP_PREVIEW/Math.min(w,h);
  const x=Math.max(0,(w*base*d.scale-CROP_PREVIEW)/2),y=Math.max(0,(h*base*d.scale-CROP_PREVIEW)/2);
  return {...d,offset:{x:Math.max(-x,Math.min(x,offset.x)),y:Math.max(-y,Math.min(y,offset.y))}};
}
/** The studio keeps a local draft; the single footer action persists the chosen identity or cropped photo. */
export function AvatarStudio({open,onClose}:{open:boolean;onClose:()=>void}) {
  const session=useMistSession(),toast=useToast(),user=session.user;
  const [mode,setMode]=React.useState<Mode>('initials');
  const [color,setColor]=React.useState<AvatarColor|null>(null),[photo,setPhoto]=React.useState<string|null>(null);
  const [busy,setBusy]=React.useState(false),[photoLoading,setPhotoLoading]=React.useState(false),[error,setError]=React.useState(''),[crop,setCrop]=React.useState<CropDraft|null>(null);
  const file=React.useRef<HTMLInputElement>(null),working=React.useRef(false),loadRevision=React.useRef(0),scope=React.useRef(user?.id);scope.current=user?.id;
  const drag=React.useRef<{id:number;x:number;y:number;start:{x:number;y:number}}|null>(null);
  const reset=()=>{
    loadRevision.current++;setPhotoLoading(false);
    const current=user?.avatarUrl;setMode(modeOf(current));setColor(parseInitialsIdentity(current) ?? patternColorFromIdentity(current,true));
    setPhoto(modeOf(current)==='photo'?current!:null);setCrop(null);setError('');
  };
  React.useEffect(()=>{if(open)reset();else loadRevision.current++;return()=>{loadRevision.current++;};},[open,user?.id]);
  const value=mode==='initials'?(color?initialsIdentity(color):null):mode==='photo'?photo:null;
  const ready=mode==='photo'?!!(photo||crop)&&!photoLoading:true;
  const save=async(chosen?:string)=>{
    if(working.current||!user||!ready)return;
    working.current=true;setBusy(true);setError('');const id=user.id;
    try{
      const next=chosen ?? (mode==='photo'&&crop?await renderCircularAvatar(crop):value);
      if(next&&next.length>MAX_AVATAR_CHARS)throw Error('头像图片太大，请缩小或换一张图片');
      await updateMyProfile({avatarUrl:next});
      if(scope.current===id){toast('头像已更新');onClose();}
    }catch(failure){if(scope.current===id)setError(explain(failure,'头像未更新，请重试'));}
    finally{working.current=false;if(scope.current===id)setBusy(false);}
  };
  const loadPhoto=async(src:string)=>{
    const revision=++loadRevision.current,id=user?.id;setPhotoLoading(true);
    try{const img=await loadImage(src);if(scope.current!==id||loadRevision.current!==revision)return;if(img.naturalWidth*img.naturalHeight>32_000_000)throw Error('图片尺寸过大，请缩小后再上传');setCrop({src,width:img.naturalWidth,height:img.naturalHeight,scale:1,rotation:0,offset:{x:0,y:0}});}
    catch(failure){if(scope.current===id&&loadRevision.current===revision)setError(explain(failure,'图片读取失败'));}
    finally{if(scope.current===id&&loadRevision.current===revision)setPhotoLoading(false);}
  };
  const pick=async(selected?:File)=>{
    if(!selected||busy)return;setError('');
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(selected.type)){setError('请选择 PNG、JPG、WebP 或 GIF 图片');return;}
    if(selected.size>12*1024*1024){setError('请选择 12MB 以内的图片');return;}
    const revision=++loadRevision.current;setPhotoLoading(true);
    try{const src=await readFile(selected);if(loadRevision.current!==revision)return;await loadPhoto(src);}catch(failure){if(loadRevision.current===revision){setPhotoLoading(false);setError(explain(failure,'图片读取失败'));}}
  };
  if(!user)return null;
  const name=user.displayName||user.email,dirty=mode==='pattern'?false:!!(mode==='photo'&&crop)||value!==(user.avatarUrl??null);
  const [rw,rh]=crop?rotatedSize(crop):[1,1],previewScale=CROP_PREVIEW/Math.min(rw,rh);
  const adjustCrop=(next:CropDraft)=>setCrop(clampCrop(next));
  return <>
    <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden aria-label={uiText('选择头像图片')} onChange={event=>{void pick(event.target.files?.[0]);event.target.value='';}}/>
    <Dialog open={open} onClose={()=>!busy&&onClose()} title={uiText('编辑头像')} width={940}
      footer={<>{mode!=='pattern'&&<Button variant="quiet" icon={Undo2} disabled={busy||!dirty} onClick={reset}>{uiText('还原')}</Button>}<span className="mist-spacer"/><Button disabled={busy} onClick={onClose}>{uiText('取消')}</Button>{mode!=='pattern'&&<Button variant="primary" loading={busy} disabled={busy||!dirty||!ready} onClick={()=>void save()}>{uiText('保存头像')}</Button>}</>}>
      <div className="mist-avatar-studio">
        {error&&<Banner tone="bad" title={uiText(error)}/>}
        <Tabs<Mode> value={mode} onChange={next=>{if(!busy){setMode(next);setError('');}}} options={[{value:'initials',label:'姓名'},{value:'pattern',label:'图案'},{value:'photo',label:'照片'}]}/>
        <div className="mist-avatar-pattern-view" hidden={mode!=='pattern'}><AvatarExplorer active={mode==='pattern'} value={user.avatarUrl} disabled={busy} palette={color??defaultAvatarColor(user.id)} onPaletteChange={setColor} onSelect={identity=>void save(identity)}/></div>
        {mode==='photo'?<div className="mist-avatar-photo-panel" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void pick(event.dataTransfer.files?.[0]);}}>
          {!crop&&!photo?<button type="button" className="mist-avatar-upload" disabled={busy||photoLoading} onClick={()=>file.current?.click()}><Icon icon={ImageUp}/><strong>{uiText(photoLoading?'正在读取照片…':'选择或拖入照片')}</strong><span>{uiText('JPG、PNG、WebP、GIF · 12MB 以内')}</span></button>:<>
            <div className="mist-avatar-photo-toolbar"><span className="mist-avatar-control-label">{uiText(crop?'调整裁剪':'照片预览')}</span><Button size="sm" variant="quiet" icon={ImageUp} disabled={busy||photoLoading} onClick={()=>file.current?.click()}>{uiText('更换照片')}</Button></div>
            {crop?<><div className="mist-avatar-crop" tabIndex={0} role="group" aria-label={uiText('拖动或使用方向键调整照片位置')} style={{width:CROP_PREVIEW,height:CROP_PREVIEW}}
              onKeyDown={event=>{const delta:Record<string,[number,number]>={ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,-5],ArrowDown:[0,5]};if(delta[event.key]&&!busy){event.preventDefault();const [x,y]=delta[event.key];adjustCrop({...crop,offset:{x:crop.offset.x+x,y:crop.offset.y+y}});}}}
              onPointerDown={event=>{if(busy)return;event.currentTarget.setPointerCapture?.(event.pointerId);drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,start:crop.offset};}} onPointerMove={event=>{const d=drag.current;if(d&&d.id===event.pointerId&&!busy)adjustCrop({...crop,offset:{x:d.start.x+event.clientX-d.x,y:d.start.y+event.clientY-d.y}});}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
              <img src={crop.src} alt={uiText('待裁剪的照片')} draggable={false} style={{width:crop.width*previewScale,height:crop.height*previewScale,transform:`translate(-50%, -50%) translate(${crop.offset.x}px, ${crop.offset.y}px) rotate(${crop.rotation}deg) scale(${crop.scale})`}}/>
            </div><div className="mist-row mist-avatar-crop-tools"><input type="range" aria-label={uiText('缩放')} min={1} max={3} step={.01} value={crop.scale} disabled={busy} onChange={event=>adjustCrop({...crop,scale:Number(event.target.value)})}/><Button size="sm" icon={RotateCw} disabled={busy} onClick={()=>adjustCrop({...crop,rotation:(crop.rotation+90)%360,offset:{x:0,y:0}})}>{uiText('旋转')}</Button></div></>:<div className="mist-avatar-photo-existing"><Avatar name={name} src={photo} size="xl"/><Button variant="quiet" disabled={busy} onClick={()=>void loadPhoto(photo!)}>{uiText('调整裁剪')}</Button></div>}
          </>}
        </div>:mode==='initials'?<div className="mist-avatar-editor" data-mode={mode}>
          <div className="mist-avatar-editor-preview" aria-busy={!ready}>
            <div className="mist-avatar-stage-card"><Avatar name={name} identityKey={user.id} src={value} size="xl"/></div>
            <div className="mist-avatar-preview-identity"><Avatar name={name} identityKey={user.id} src={value} size="xs"/><span>{name}</span></div>
          </div>
          <div className="mist-avatar-editor-controls">
            {mode==='initials'&&<InitialsChoices name={name} identityKey={user.id} value={color} disabled={busy} onChange={setColor}/>}
          </div>
        </div>:null}
      </div>
    </Dialog>
  </>;
}
export function AvatarSettingRow() {
  const session=useMistSession(),[open,setOpen]=React.useState(false),user=session.user;
  if(!user)return null;
  return <div className="mist-avatar-setting"><Avatar name={user.displayName||user.email} identityKey={user.id} src={user.avatarUrl} size="xl"/><b>{uiText('头像')}</b><span className="mist-spacer"/><Button size="sm" onClick={()=>setOpen(true)}>{uiText('编辑头像')}</Button><AvatarStudio key={user.id} open={open} onClose={()=>setOpen(false)}/></div>;
}
