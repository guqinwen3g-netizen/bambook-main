import React from 'react';
import { useDevice, writeDevice, type DeviceValues } from '../../services/devicePreferences';
import { uiText } from '../../services/interfaceLanguage';
import { Select } from './form';
import { SettingRow } from './patterns';

/** Personal device preference, available to company members and platform accounts alike. */
export function LanguageSetting() {
  const locale = useDevice('locale');
  return <SettingRow title={uiText('界面语言')} control={
    <Select aria-label={uiText('界面语言')} value={locale} onChange={event => writeDevice('locale', event.target.value as DeviceValues['locale'])}
      options={[{ value: 'system', label: uiText('本机语言') }, { value: 'zh-CN', label: '中文' }, { value: 'en-US', label: 'English' }]} />
  } />;
}
