import React from 'react';
import { Paperclip, X } from 'lucide-react';
import { Button, Icon, IconButton } from '../../../../../components/mist';
import {
  isTaskAttachment, taskAttachmentLabels, TASK_ATTACHMENT_ACCEPT, TASK_ATTACHMENT_BYTES, TASK_ATTACHMENT_COUNT, TASK_ATTACHMENT_TOTAL_BYTES,
} from '../../../../../server/src/shared/mistTaskAttachments';
import { ui, uiText } from '../../../../../services/interfaceLanguage';

type Props = {
  existing?: readonly { size: number }[];
  files: readonly File[];
  onChange: (files: readonly File[]) => void;
  disabled?: boolean;
};

export function XiaozhuAnswerFiles({ existing = [], files, onChange, disabled }: Props) {
  const input = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState('');
  const labels = taskAttachmentLabels(files);
  const add = (incoming: File[]) => {
    if (disabled || !incoming.length) return;
    if (incoming.some(file => !isTaskAttachment(file.name))) {
      setError('此文件类型暂不支持');
      return;
    }
    const next = [...files, ...incoming];
    const total = [...existing, ...next].reduce((sum, file) => sum + file.size, 0);
    if (existing.length + next.length > TASK_ATTACHMENT_COUNT || total > TASK_ATTACHMENT_TOTAL_BYTES
      || incoming.some(file => !file.size || file.size > TASK_ATTACHMENT_BYTES)) {
      setError('最多 6 个附件，单个不超过 8 MiB，总计不超过 24 MiB');
      return;
    }
    setError('');
    onChange(next);
  };
  return <div className="mist-col" onDragOver={event => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  }} onDrop={event => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    add(Array.from(event.dataTransfer.files));
  }}>
    <div className="mist-row" data-wrap>
      <input ref={input} type="file" hidden multiple accept={TASK_ATTACHMENT_ACCEPT} disabled={disabled}
        onChange={event => {
          add(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }} />
      <Button icon={Paperclip} size="sm" variant="quiet" disabled={disabled} onClick={() => input.current?.click()}>
        {uiText('添加附件')}
      </Button>
    </div>
    {!!files.length && <div className="mist-xz-sources" aria-label={uiText('附件')}>
      {files.map((file, index) => <span key={index} className="mist-xz-source" data-attachment>
        <Icon icon={Paperclip} size="xs" />
        <span title={labels[index]}>{labels[index]}</span>
        <IconButton size="sm" icon={X} label={ui`移除附件 ${labels[index]}`} disabled={disabled}
          onClick={() => { setError(''); onChange(files.filter((_, position) => position !== index)); }}/>
      </span>)}
    </div>}
    {error && <p className="mist-xz-note" role="alert">{uiText(error)}</p>}
  </div>;
}
