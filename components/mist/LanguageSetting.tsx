import React from 'react';
import { useDevice, writeDevice, type DeviceValues } from '../../services/devicePreferences';
import { uiText } from '../../services/interfaceLanguage';
import { Select } from './form';
import { SettingRow } from './patterns';

/** Personal device preference, available to company members and platform accounts alike. */
export function LanguageSetting() {
  const locale = useDevice('locale');
  return <SettingRow title={uiText('界面语言')} description={uiText('只保存在这台设备，切换后立即生效。')} control={
    <Select aria-label={uiText('界面语言')} value={locale} onChange={event => writeDevice('locale', event.target.value as DeviceValues['locale'])}
      options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' }]} />
  } />;
}
