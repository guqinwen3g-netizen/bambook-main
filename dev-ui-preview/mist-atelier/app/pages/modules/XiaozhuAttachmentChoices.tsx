import React from 'react';
import { FileText } from 'lucide-react';
import { Button, Checkbox, Field } from '../../../../../components/mist';
import { PDF_VISUAL_PAGE_LIMIT, type TaskAttachment } from '../../../../../server/src/shared/mistTaskAttachments';
import { ui, uiText } from '../../../../../services/interfaceLanguage';

export function XiaozhuAttachmentChoices({ prompt, choices, selected, disabled, onChoose }: {
  prompt: string;
  choices: readonly {file:TaskAttachment;label:string}[];
  selected?: string;
  disabled?: boolean;
  onChoose: (label: string) => void;
}) {
  return <div className="mist-xz-attachment-choices" role="group" aria-label={uiText(prompt)}>
    {choices.map(({ file, label }) => {
      const pressed = selected === undefined ? undefined : selected === label;
      return <Button key={file.id} size="sm" icon={FileText} variant={pressed ? 'ai' : 'secondary'}
        aria-pressed={pressed} disabled={disabled} onClick={() => onChoose(label)}>
        <span>{label}</span>
      </Button>;
    })}
  </div>;
}

export function XiaozhuVisualPageChoices({choices,value,disabled,onChange}:{
  choices:readonly {fileId:string;label:string;pages:readonly number[]}[];
  value:string;
  disabled?:boolean;
  onChange:(value:string)=>void;
}){
  const selected=new Set(value.split('\n').filter(Boolean));
  return <div className="mist-col">
    <span className="mist-label">{uiText('选择要核对的页码（最多 3 页）')}</span>
    {choices.map(({fileId,label,pages})=><Field key={fileId} group label={label}>
      <div className="mist-xz-page-options">{pages.map(page=>{
        const answer=label+' 第 '+page+' 页',checked=selected.has(answer);
        return <Checkbox key={page} label={ui`第 ${page} 页`} checked={checked}
          disabled={disabled||!checked&&selected.size>=PDF_VISUAL_PAGE_LIMIT}
          onChange={on=>{
            const next=new Set(selected);
            if(on)next.add(answer);else next.delete(answer);
            onChange([...next].join('\n'));
          }}/>;
      })}</div>
    </Field>)}
  </div>;
}

export function XiaozhuWorksheetChoices({names,selected,disabled,onChoose}:{
  names:readonly string[];
  selected?:string;
  disabled?:boolean;
  onChoose:(value:string)=>void;
}){
  return <div className="mist-xz-attachment-choices" role="group" aria-label={uiText('选择工作表')}>
    {names.map(name=>{
      const value=name===name.trim()?name:'「'+name+'」';
      const pressed=selected===undefined?undefined:selected===value;
      return <Button key={name} size="sm" variant={pressed?'ai':'secondary'} aria-pressed={pressed}
        disabled={disabled} onClick={()=>onChoose(value)}><span>{name}</span></Button>;
    })}
  </div>;
}
