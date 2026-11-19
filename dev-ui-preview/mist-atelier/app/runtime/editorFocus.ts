import {useCallback} from 'react';

/** Entering a full-page editor/step moves focus; source refreshes preserve the active input. */
export function useEditorStepFocus(step:string|number){
  // The region can appear after a readonly view without changing the step. A stable callback ref
  // covers that mount as well as step changes, while ordinary source refreshes keep their focus.
  return useCallback((section:HTMLDivElement|null)=>{
    if(!section)return;
    // :disabled includes a disabled ancestor fieldset as well as a control's own attribute.
    const field=section?.querySelector<HTMLElement>('.mist-form-section input:not([type="hidden"]):not([type="file"]):not(:disabled), .mist-form-section textarea:not(:disabled), .mist-form-section select:not(:disabled), .mist-form-section button[role="combobox"]:not(:disabled)');
    (field??section)?.focus();
  },[step]);
}
