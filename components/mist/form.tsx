import { uiText, ui } from '../../services/interfaceLanguage';
import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, Eye, EyeOff, Search, UploadCloud } from 'lucide-react';
import { Icon } from './primitives';
import { cx } from './types';
import { DateInput } from './DateInput';
import { AutocompleteInput } from './AutocompleteInput';

/** 表单栅格：默认两列；字段加 full 占满一行。 */
export function FormGrid({ cols = 2, children, style }: { cols?: 1 | 2 | 3; children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="mist-form" data-cols={cols === 2 ? undefined : cols} style={style}>{uiText(children)}</div>;
}

export type FieldProps = { label: React.ReactNode; required?: boolean; hint?: React.ReactNode; error?: React.ReactNode; full?: boolean; children: React.ReactNode; htmlFor?: string };
/** 字段外框：标签 + 控件 + 提示/错误。error 存在时整个输入底变红色 tint。 */
export function Field({ label, required, hint, error, full, children, htmlFor }: FieldProps) {
  return (
    <label className="mist-field" data-full={full || undefined} data-error={error ? true : undefined} htmlFor={htmlFor}>
      <span className="mist-field-label">{uiText(label)}{required && <em>*</em>}</span>
      {uiText(children)}
      {(error || hint) && <span className="mist-field-hint">{uiText(error || hint)}</span>}
    </label>
  );
}

type InputBase = { icon?: LucideIcon; suffix?: React.ReactNode; disabled?: boolean };
/** 单行输入。外层是填充底（无描边），聚焦变强调色浅底。 */
export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & InputBase>(function TextInput({ icon, suffix, className, disabled, type, list, ...rest }, ref) {
  if (type === 'date' || type === 'datetime-local' || type === 'month' || type === 'time') return <DateInput ref={ref} type={type === 'date' ? 'date' : type === 'datetime-local' ? 'datetime-local' : type === 'month' ? 'month' : 'time'} icon={icon} suffix={suffix} className={className} disabled={disabled} {...rest} />;
  if (list) return <AutocompleteInput ref={ref} list={list} type={type} icon={icon} suffix={suffix} className={className} disabled={disabled} {...rest} />;
  return <span className={cx('mist-input', className)} data-disabled={disabled || undefined}>{icon && <Icon icon={icon} size="sm" />}<input ref={ref} type={type} disabled={disabled} {...rest} />{suffix && <span className="mist-input-suffix">{suffix}</span>}</span>;
});
/** 密码输入：右侧眼睛按钮切换明文显示。按下按钮不夺走输入焦点，光标位置保持不变。 */
export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & Omit<InputBase, 'suffix'>>(function PasswordInput({ icon, className, disabled, ...rest }, ref) {
  const [shown, setShown] = React.useState(false);
  return <span className={cx('mist-input', className)} data-disabled={disabled || undefined}>{icon && <Icon icon={icon} size="sm" />}<input ref={ref} type={shown ? 'text' : 'password'} disabled={disabled} {...rest} />
    <button type="button" className="mist-input-reveal" aria-label={uiText(shown ? '隐藏密码' : '显示密码')} title={uiText(shown ? '隐藏密码' : '显示密码')} aria-pressed={shown} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => setShown(v => !v)}><Icon icon={shown ? EyeOff : Eye} size="sm" /></button></span>;
});
/** 分格验证码：逐位输入自动跳格，可整段粘贴，退格回到上一格；填满时触发 onComplete。 */
export function CodeInput({ length = 6, value, onChange, onComplete, disabled, autoFocus, ariaLabel = '验证码' }: { length?: number; value: string; onChange: (value: string) => void; onComplete?: (value: string) => void; disabled?: boolean; autoFocus?: boolean; ariaLabel?: string }) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  React.useEffect(() => { if (autoFocus) refs.current[Math.min(value.length, length - 1)]?.focus(); }, [autoFocus]);
  const update = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    refs.current[Math.min(clean.length, length - 1)]?.focus();
    if (clean.length === length) onComplete?.(clean);
  };
  const key = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') { event.preventDefault(); update(value.slice(0, value[index] ? index : Math.max(0, index - 1))); }
    else if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); refs.current[index - 1]?.focus(); }
    else if (event.key === 'ArrowRight' && index < length - 1) { event.preventDefault(); refs.current[index + 1]?.focus(); }
  };
  return <div className="mist-code" role="group" aria-label={uiText(ariaLabel)}>
    {Array.from({ length }, (_, index) => <input key={index} ref={element => { refs.current[index] = element; }} value={value[index] ?? ''} inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} aria-label={ui`${ariaLabel}第 ${index + 1} 位`} disabled={disabled}
      onChange={event => { const typed = event.target.value.replace(/\D/g, ''); if (typed) update(value.slice(0, Math.min(index, value.length)) + typed); }}
      onPaste={event => { event.preventDefault(); update(value.slice(0, Math.min(index, value.length)) + event.clipboardData.getData('text')); }}
      onKeyDown={event => key(index, event)} onFocus={event => event.target.select()} />)}
  </div>;
}
export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & InputBase>(function TextArea({ icon, className, disabled, rows = 3, ...rest }, ref) {
  return <span className={cx('mist-input', className)} data-multiline data-disabled={disabled || undefined}>{icon && <Icon icon={icon} size="sm" />}<textarea ref={ref} rows={rows} disabled={disabled} {...rest} /></span>;
});
export { Select } from './Select';
export function SearchField({ value, onChange, placeholder = '搜索', autoFocus, style }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; style?: React.CSSProperties }) {
  return <label className="mist-search" style={style}><Icon icon={Search} size="sm" /><input value={value} onChange={e => onChange(e.target.value)} placeholder={uiText(placeholder)} autoFocus={autoFocus} aria-label={uiText(placeholder)} /></label>;
}

export function Checkbox({ checked, onChange, label, tone, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; tone?: 'ok'; disabled?: boolean }) {
  return <label className="mist-check" data-tone={tone}><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><span className="mist-check-box"><Icon icon={Check} size="xs" /></span>{uiText(label)}</label>;
}
export function Switch({ checked, onChange, label, disabled, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean; ariaLabel?: string }) {
  return <label className="mist-switch"><input type="checkbox" role="switch" aria-label={uiText(ariaLabel)} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><span className="mist-switch-track" />{uiText(label)}</label>;
}

export type Choice<V extends string> = { value: V; title: React.ReactNode; description?: React.ReactNode; icon?: LucideIcon };
/** 选择卡（大单选）：用于「认可 / 需修改 / 不采用」这类关键决策。 */
export function ChoiceCards<V extends string>({ options, value, onChange, cols = 3, ariaLabel, disabled }: { options: Choice<V>[]; value: V; onChange: (v: V) => void; cols?: number; ariaLabel?: string; disabled?: boolean }) {
  return (
    <div className="mist-choices" role="radiogroup" aria-label={uiText(ariaLabel)} style={{ ['--mist-choice-cols' as string]: cols }}>
      {options.map(o => (
        <button key={o.value} type="button" disabled={disabled} role="radio" aria-checked={o.value === value} className="mist-choice" onClick={() => onChange(o.value)}>
          <b>{o.icon && <Icon icon={o.icon} size="sm" />}{uiText(o.title)}<span className="mist-radio" /></b>
          {o.description && <small>{uiText(o.description)}</small>}
        </button>
      ))}
    </div>
  );
}

/** 上传区：点击或拖拽。onFiles 拿到 File[]。 */
export function UploadZone({ title = '拖拽文件到这里，或点击上传', hint, accept, multiple = true, onFiles }: { title?: React.ReactNode; hint?: React.ReactNode; accept?: string; multiple?: boolean; onFiles: (files: File[]) => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  return (
    <div className="mist-upload" data-over={over || undefined} role="button" tabIndex={0}
      onClick={() => ref.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') ref.current?.click(); }}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onFiles(Array.from(e.dataTransfer.files)); }}>
      <Icon icon={UploadCloud} size="lg" /><b>{uiText(title)}</b>{hint && <span>{uiText(hint)}</span>}
      <input ref={ref} type="file" hidden accept={accept} multiple={multiple} onChange={e => onFiles(Array.from(e.target.files || []))} />
    </div>
  );
}

/** 表单分节（创建/编辑页）：标题 + 说明 + 内容，节与节之间 1px 分隔。 */
export function FormSection({ id, title, description, children }: { id?: string; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode }) {
  return <section className="mist-form-section" id={id}><div className="mist-form-section-h"><div className="mist-h2">{uiText(title)}</div>{description && <p>{uiText(description)}</p>}</div>{uiText(children)}</section>;
}
