import React from 'react';
import { Laptop, Moon, Sun } from 'lucide-react';
import { ChoiceCards, Select, SettingRow, Switch } from '../../../../components/mist';
import { LanguageSetting } from '../../../../components/mist/LanguageSetting';
import { uiText } from '../../../../services/interfaceLanguage';
import { useDevice, writeDevice, type DeviceValues } from '../runtime/devicePreferences';
import { onThemePreference, readThemePreference, writeThemePreference, type ThemePreference } from '../runtime/themePreference';
import { DeviceSounds } from './DeviceSounds';

/** Personal preferences never dispatch a company settings command. */
export function DeviceAppearance() {
  const [theme, setTheme] = React.useState<ThemePreference>(readThemePreference);
  const density = useDevice('density'), reducedMotion = useDevice('reducedMotion');
  React.useEffect(() => onThemePreference(setTheme), []);
  return <>
    <LanguageSetting />
    <ChoiceCards<ThemePreference> ariaLabel={uiText('主题')} value={theme} onChange={writeThemePreference} options={[
      { value: 'light', title: '浅色', icon: Sun }, { value: 'dark', title: '深色', icon: Moon }, { value: 'system', title: '跟随系统', icon: Laptop },
    ]} />
    <SettingRow title={uiText('列表密度')} control={<Select aria-label={uiText('列表密度')} value={density} onChange={event => writeDevice('density', event.target.value as DeviceValues['density'])} options={[
      { value: 'compact', label: '紧凑' }, { value: 'default', label: '标准' }, { value: 'comfy', label: '宽松' },
    ]} />} />
    <SettingRow title={uiText('减少动效')} control={<Switch ariaLabel={uiText('减少动效')} checked={reducedMotion} onChange={value => writeDevice('reducedMotion', value)} />} />
    <DeviceSounds />
  </>;
}
