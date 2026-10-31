import React from 'react';
import { BookOpen } from 'lucide-react';
import { Icon } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import { getAuthApiBase } from '../../../../services/authService';
import { manualUrl } from '../runtime/manual';

export function ManualLink({ variant = 'icon' }: { variant?: 'icon' | 'button' }) {
  return <a className={variant === 'icon' ? 'mist-icon-btn' : 'mist-btn'} href={manualUrl(window.location.href, import.meta.env.BASE_URL, getAuthApiBase())} target="_blank" rel="noopener noreferrer" aria-label={uiText('使用手册')} title={uiText('使用手册')}>
    <Icon icon={BookOpen} size={variant === 'icon' ? 'md' : 'sm'} />
    {variant === 'button' && <span className="mist-btn-t">{uiText('打开手册')}</span>}
  </a>;
}
