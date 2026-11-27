import React from 'react';
import { FileText } from 'lucide-react';
import { Button } from '../../../../../components/mist';
import type { taskWorkbookChoices } from '../../../../../server/src/shared/mistTaskAttachments';
import { uiText } from '../../../../../services/interfaceLanguage';

export const workbookChoicePrompt = '选择要读取的工作簿';

export function XiaozhuWorkbookChoices({ choices, selected, disabled, onChoose }: {
  choices: ReturnType<typeof taskWorkbookChoices>;
  selected?: string;
  disabled?: boolean;
  onChoose: (label: string) => void;
}) {
  return <div className="mist-xz-workbook-choices" role="group" aria-label={uiText(workbookChoicePrompt)}>
    {choices.map(({ file, label }) => {
      const pressed = selected === undefined ? undefined : selected === label;
      return <Button key={file.id} size="sm" icon={FileText} variant={pressed ? 'ai' : 'secondary'}
        aria-pressed={pressed} disabled={disabled} onClick={() => onChoose(label)}>
        <span>{label}</span>
      </Button>;
    })}
  </div>;
}
