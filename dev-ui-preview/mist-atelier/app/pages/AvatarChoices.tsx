import React from 'react';
import { Check, Shuffle } from 'lucide-react';
import { Icon } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import { AVATAR_COLORS, defaultAvatarColor, type AvatarColor } from '../../../../lib/avatarIdentity';

export function InitialsChoices({name,identityKey,value,disabled,onChange}:{name:string;identityKey:string;value:AvatarColor|null;disabled:boolean;onChange:(next:AvatarColor|null)=>void}) {
  const automatic=AVATAR_COLORS.find(x=>x.id===defaultAvatarColor(identityKey))!;
  const choices=[{...automatic,id:null,label:'自动'},...AVATAR_COLORS];
  return <div className="mist-avatar-option-grid mist-avatar-initial-options" role="group" aria-label={uiText('头像底色')}>{choices.map(item=><button key={item.id??'auto'} type="button" className="mist-avatar-choice" disabled={disabled} aria-label={uiText(item.label)} aria-pressed={value===item.id} onClick={()=>onChange(item.id)}>{item.id===null?<span className="mist-avatar-auto-choice"><Icon icon={Shuffle}/></span>:<span className="mist-avatar-color-example" style={{backgroundColor:item.value,color:item.ink}}>{name.slice(0,1)}</span>}<span>{uiText(item.label)}</span>{value===item.id&&<span className="mist-avatar-choice-check"><Icon icon={Check} size="xs"/></span>}</button>)}</div>;
}
