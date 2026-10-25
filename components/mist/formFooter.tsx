import React from 'react';
import { createPortal } from 'react-dom';
import { uiText } from '../../services/interfaceLanguage';

export const FormFooterTargetContext = React.createContext<HTMLElement | null>(null);
export const FormFooterWidthContext = React.createContext<'narrow' | 'wide' | undefined>(undefined);

/** Form actions belong outside the scrolling fields. Standalone previews stay in normal flow. */
export function FormFooter({ children }: { children: React.ReactNode }) {
  const target = React.useContext(FormFooterTargetContext);
  const width = React.useContext(FormFooterWidthContext);
  const footer = <div className="mist-form-footer" data-form-footer data-width={width}>
    <div className="mist-form-footer-content">{uiText(children)}</div>
  </div>;
  return target ? createPortal(footer, target) : footer;
}
