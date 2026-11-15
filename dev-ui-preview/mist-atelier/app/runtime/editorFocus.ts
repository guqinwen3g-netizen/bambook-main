import {useEffect,useRef} from 'react';

/** Entering a full-page editor/step moves focus; source refreshes preserve the active input. */
export function useEditorStepFocus(step:string|number){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const section=ref.current;
    // :disabled includes a disabled ancestor fieldset as well as a control's own attribute.
    const field=section?.querySelector<HTMLElement>('.mist-form-section input:not([type="hidden"]):not([type="file"]):not(:disabled), .mist-form-section textarea:not(:disabled), .mist-form-section select:not(:disabled), .mist-form-section button[role="combobox"]:not(:disabled)');
    (field??section)?.focus();
  },[step]);
  return ref;
}
