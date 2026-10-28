import React from 'react';
import { Check, Shuffle } from 'lucide-react';
import { Avatar, Button, Icon, Segmented, Switch, useAvatarSource } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import { AVATAR_COLORS, ANIMATED_AVATAR_FAMILIES, avatarIdentity, defaultAvatarColor, defaultPersonAvatar, parseAvatarIdentity, personIdentity, PERSON_BACKGROUNDS, PERSON_CHOICES, PERSON_CLOTHES_COLORS, PERSON_HAIR_COLORS, PERSON_SKIN_COLORS, type AvatarColor, type PersonAvatar } from '../../../../lib/avatarIdentity';

export function ColorChoices({label,values,names,value,disabled,onChange}:{label:string;values:readonly string[];names?:readonly string[];value:string;disabled:boolean;onChange:(value:string)=>void}) {
  return <div className="mist-avatar-color-field"><span className="mist-avatar-control-label">{uiText(label)}</span><div className="mist-avatar-swatches" role="group" aria-label={uiText(label)}>{values.map((color,index)=><button key={color} type="button" disabled={disabled} aria-pressed={color===value} aria-label={uiText(`${label} · ${names?.[index]??index+1}`)} title={uiText(names?.[index]??`${label} ${index+1}`)} style={{backgroundColor:color}} onClick={()=>onChange(color)}>{color===value&&<Icon icon={Check} size="xs"/>}</button>)}</div></div>;
}
function Choice({label,value,selected,disabled,onClick}:{label:string;value:string;selected:boolean;disabled:boolean;onClick:()=>void}) {
  const rendered=useAvatarSource(value),last=React.useRef<string|undefined>(undefined);if(rendered)last.current=rendered;
  return <button type="button" disabled={disabled} className="mist-avatar-choice" aria-label={uiText(label)} aria-pressed={selected} onClick={onClick}>
    <Avatar name="" src={rendered??last.current??value} size="lg"/><span>{uiText(label)}</span>{selected&&<span className="mist-avatar-choice-check"><Icon icon={Check} size="xs"/></span>}
  </button>;
}
const HAIR:Array<{label:string;hair:PersonAvatar['hair'];backHair:PersonAvatar['backHair']}>= [
  {label:'自然侧分',hair:'sideComed',backHair:'none'}, {label:'清爽短发',hair:'undercut',backHair:'none'},
  {label:'蓬松短发',hair:'spiky',backHair:'none'}, {label:'束发',hair:'bun',backHair:'none'},
  {label:'半扎长发',hair:'bun',backHair:'longStraight'}, {label:'披肩直发',hair:'sideComed',backHair:'longStraight'},
  {label:'长卷发',hair:'sideComed',backHair:'longWavy'}, {label:'齐肩发',hair:'sideComed',backHair:'shoulderHigh'},
  {label:'无发',hair:'none',backHair:'none'},
];
const templatePeople=(seed:string)=>{
  const base=defaultPersonAvatar(seed);
  return [base,{...base,hair:'bun',backHair:'longStraight',skin:PERSON_SKIN_COLORS[0],clothes:'turtleNeck',clothesColor:PERSON_CLOTHES_COLORS[1],background:PERSON_BACKGROUNDS[1]},
    {...base,hair:'undercut',skin:PERSON_SKIN_COLORS[2],clothes:'openJacket',clothesColor:PERSON_CLOTHES_COLORS[2],background:PERSON_BACKGROUNDS[2]},
    {...base,hair:'sideComed',backHair:'shoulderHigh',clothesColor:PERSON_CLOTHES_COLORS[3],background:PERSON_BACKGROUNDS[3]},
    {...base,hair:'spiky',clothes:'tShirt',clothesColor:PERSON_CLOTHES_COLORS[4],background:PERSON_BACKGROUNDS[4]},
    {...base,hair:'sideComed',backHair:'longWavy',skin:PERSON_SKIN_COLORS[3],clothes:'dress',clothesColor:PERSON_CLOTHES_COLORS[5],background:PERSON_BACKGROUNDS[5]},
  ] as PersonAvatar[];
};
type Part='style'|'hair'|'face'|'clothes'|'colors';
export function PersonChoices({value,onChange,disabled}:{value:PersonAvatar;onChange:(value:PersonAvatar)=>void;disabled:boolean}) {
  const [part,setPart]=React.useState<Part>('style'),[face,setFace]=React.useState<'eyes'|'brows'|'mouth'>('eyes');
  const update=<K extends keyof PersonAvatar>(key:K,next:PersonAvatar[K])=>onChange({...value,[key]:next});
  return <>
    <div className="mist-avatar-part-tabs" role="tablist" aria-label={uiText('人物部件')} onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||disabled)return;
      const ids:Part[]=['style','hair','face','clothes','colors'],index=ids.indexOf(part);
      const next=event.key==='Home'?0:event.key==='End'?ids.length-1:(index+(event.key==='ArrowRight'?1:-1)+ids.length)%ids.length;
      event.preventDefault();setPart(ids[next]);event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>{([['style','形象'],['hair','发型'],['face','表情'],['clothes','服装'],['colors','配色']] as const).map(([id,label])=><button type="button" role="tab" key={id} aria-selected={part===id} tabIndex={part===id?0:-1} disabled={disabled} onClick={()=>setPart(id)}>{uiText(label)}</button>)}</div>
    <div className="mist-avatar-choice-panel" role="tabpanel" aria-label={uiText({style:'人物形象',hair:'发型选择',face:'表情选择',clothes:'服装选择',colors:'人物配色'}[part])}>
      {part==='style'&&<div className="mist-avatar-option-grid">{templatePeople(value.seed).map((preset,i)=><Choice key={i} label={['清爽侧分','长发针织','短发外套','齐肩衬衫','休闲短发','卷发长裙'][i]} value={personIdentity(preset)} selected={personIdentity(value)===personIdentity(preset)} disabled={disabled} onClick={()=>onChange(preset)}/>)}</div>}
      {part==='hair'&&<><div className="mist-avatar-option-grid">{HAIR.map(({label,hair,backHair})=><Choice key={label} label={label} value={personIdentity({...value,hair,backHair})} selected={value.hair===hair&&value.backHair===backHair} disabled={disabled} onClick={()=>onChange({...value,hair,backHair})}/>)}</div><ColorChoices label="发色" values={PERSON_HAIR_COLORS} names={['自然黑','深棕','栗棕','棕色','金棕','银灰']} value={value.hairColor} disabled={disabled} onChange={next=>update('hairColor',next)}/></>}
      {part==='face'&&<><Segmented<'eyes'|'brows'|'mouth'> ariaLabel={uiText('表情部件')} value={face} onChange={setFace} options={[{value:'eyes',label:'眼睛'},{value:'brows',label:'眉形'},{value:'mouth',label:'嘴型'}]}/><div className="mist-avatar-option-grid">{(PERSON_CHOICES[face] as readonly (readonly [string,string])[]).map(([id,label])=><Choice key={id} label={label} value={personIdentity({...value,[face]:id})} selected={value[face]===id} disabled={disabled} onClick={()=>onChange({...value,[face]:id})}/>)}</div></>}
      {part==='clothes'&&<><div className="mist-avatar-option-grid">{PERSON_CHOICES.clothes.map(([id,label])=><Choice key={id} label={label} value={personIdentity({...value,clothes:id})} selected={value.clothes===id} disabled={disabled} onClick={()=>update('clothes',id)}/>)}</div><ColorChoices label="衣服颜色" names={['雾蓝','米白','豆绿','暖灰','藏蓝','莓红','炭灰','驼色']} values={PERSON_CLOTHES_COLORS} value={value.clothesColor} disabled={disabled} onChange={next=>update('clothesColor',next)}/></>}
      {part==='colors'&&<><ColorChoices label="肤色" values={PERSON_SKIN_COLORS} names={['浅暖','暖杏','自然','蜜棕','暖棕','深棕']} value={value.skin} disabled={disabled} onChange={next=>update('skin',next)}/><ColorChoices label="发色" values={PERSON_HAIR_COLORS} names={['自然黑','深棕','栗棕','棕色','金棕','银灰']} value={value.hairColor} disabled={disabled} onChange={next=>update('hairColor',next)}/><ColorChoices label="衣服颜色" names={['雾蓝','米白','豆绿','暖灰','藏蓝','莓红','炭灰','驼色']} values={PERSON_CLOTHES_COLORS} value={value.clothesColor} disabled={disabled} onChange={next=>update('clothesColor',next)}/><ColorChoices label="背景" values={PERSON_BACKGROUNDS} names={['雾青','米灰','浅绿','浅陶','雾蓝','浅玫','沙色','石灰']} value={value.background} disabled={disabled} onChange={next=>update('background',next)}/></>}
    </div>
  </>;
}
export function InitialsChoices({name,identityKey,value,disabled,onChange}:{name:string;identityKey:string;value:AvatarColor|null;disabled:boolean;onChange:(next:AvatarColor|null)=>void}) {
  const choices=[{id:null,label:'自动',value:AVATAR_COLORS.find(x=>x.id===defaultAvatarColor(identityKey))!.value},...AVATAR_COLORS];
  return <div className="mist-avatar-option-grid mist-avatar-initial-options" role="group" aria-label={uiText('头像底色')}>{choices.map(item=><button key={item.id??'auto'} type="button" className="mist-avatar-choice" disabled={disabled} aria-label={uiText(item.label)} aria-pressed={value===item.id} onClick={()=>onChange(item.id)}><span className="mist-avatar-color-example" style={{backgroundColor:item.value}}>{name.slice(0,1)}</span><span>{uiText(item.label)}</span>{value===item.id&&<span className="mist-avatar-choice-check"><Icon icon={Check} size="xs"/></span>}</button>)}</div>;
}
const PATTERNS=[['glass','琉璃'],['waves','波纹'],['weave','织纹'],['blobs','流形'],['squircles','柔方'],['disco','光谱'],['landscape','风景'],['planets','星球'],['glyphs','符号']] as const;
export function PatternChoices({value,onChange,disabled}:{value:string;onChange:(value:string)=>void;disabled:boolean}) {
  const parsed=parseAvatarIdentity(value),[seed,setSeed]=React.useState(()=>parsed?.seed??'c205_v6_'+crypto.randomUUID());
  const hue=Number(parsed?.seed.match(/^c(\d+)_/)?.[1]??205);
  const seedFor=(h:number)=>seed.replace(/^c\d+_/,`c${h}_`);
  const recolor=(h:number)=>{const current=parsed?.seed??seed;onChange(avatarIdentity(parsed?.family??'glass',/^c\d+_/.test(current)?current.replace(/^c\d+_/,`c${h}_`):`c${h}_v6_${crypto.randomUUID()}`,parsed?.animated??false));};
  return <><div className="mist-avatar-panel-head"><span className="mist-avatar-control-label">{uiText('图案')}</span><Button size="sm" variant="quiet" icon={Shuffle} disabled={disabled} onClick={()=>setSeed(`c${hue}_v6_${crypto.randomUUID()}`)}>{uiText('换一组')}</Button></div><div className="mist-avatar-option-grid">{PATTERNS.map(([family,label])=>{const id=avatarIdentity(family,seedFor(hue),parsed?.family===family&&parsed.animated);return <Choice key={family} label={label} value={id} selected={value===id} disabled={disabled} onClick={()=>onChange(id)}/>;})}</div><ColorChoices label="色调" values={AVATAR_COLORS.map(x=>x.value)} names={AVATAR_COLORS.map(x=>x.label)} value={AVATAR_COLORS[[205,155,100,22,335,240,45,275].indexOf(hue)]?.value??AVATAR_COLORS[0].value} disabled={disabled} onChange={next=>recolor([205,155,100,22,335,240,45,275][AVATAR_COLORS.findIndex(x=>x.value===next)])}/>{parsed&&ANIMATED_AVATAR_FAMILIES.has(parsed.family)&&<div className="mist-avatar-panel-head"><span>{uiText('动态')}</span><Switch ariaLabel={uiText('动态')} checked={parsed.animated} disabled={disabled} onChange={animated=>onChange(avatarIdentity(parsed.family,parsed.seed,animated))}/></div>}</>;
}
