import React from 'react';
import { FileText } from 'lucide-react';
import { Button } from '../../../../../components/mist';
import type { TaskAttachment } from '../../../../../server/src/shared/mistTaskAttachments';
import { uiText } from '../../../../../services/interfaceLanguage';

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
