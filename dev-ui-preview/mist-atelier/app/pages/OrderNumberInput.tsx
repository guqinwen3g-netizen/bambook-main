import React from 'react';
import { TextInput } from '../../../../components/mist';

type Props = Omit<React.ComponentProps<typeof TextInput>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValueChange: (value: number) => void;
};

/** Keep editing text separate from the numeric order model: clearing must not reinsert zero. */
export function OrderNumberInput({ value, onValueChange, onFocus, onBlur, ...props }: Props) {
  const [draft, setDraft] = React.useState(String(value));
  const emitted = React.useRef(value);
  React.useEffect(() => {
    if (props.disabled || !Object.is(value, emitted.current)) {
      emitted.current = value;
      setDraft(String(value));
    }
  }, [value, props.disabled]);
  return <TextInput {...props} type="text" inputMode="decimal" value={draft}
    onFocus={event => { if (event.currentTarget.value === '0') event.currentTarget.select(); onFocus?.(event); }}
    onChange={event => {
      const text = event.target.value.replace(/^([+-]?)0+(?=\d)/, '$1');
      setDraft(text);
      emitted.current = Number(text);
      onValueChange(emitted.current);
    }}
    onBlur={event => {
      if (draft.trim() !== '' && Number.isFinite(value)) setDraft(String(value));
      onBlur?.(event);
    }} />;
}
