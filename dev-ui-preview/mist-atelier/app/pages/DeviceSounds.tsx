import React from 'react';
import { Button, Select, SettingRow, Switch } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import { getUiSoundPreferences, previewUiSound, setUiSoundPreferences, subscribeUiSoundPreferences, type UiSoundStyle } from '../../../../services/uiSoundService';

/** Device-local sound preferences; no company data is changed. */
export function DeviceSounds() {
  const sound = React.useSyncExternalStore(subscribeUiSoundPreferences, getUiSoundPreferences, getUiSoundPreferences);
  return <>
    <SettingRow title={uiText('通知提示音')} control={<div className="mist-sound-controls"><Button size="sm" variant="quiet" disabled={!sound.notifications || !sound.volume} onClick={() => void previewUiSound('notifications')}>{uiText('试听通知')}</Button><Switch ariaLabel={uiText('通知提示音')} checked={sound.notifications} onChange={value => setUiSoundPreferences({ notifications: value })}/></div>}/>
    <SettingRow title={uiText('声音风格')} control={<Select aria-label={uiText('声音风格')} value={sound.soundStyle} onChange={event => { setUiSoundPreferences({ soundStyle: event.target.value as UiSoundStyle }); if (sound.volume && sound.notifications) void previewUiSound('notifications'); else if (sound.volume && sound.operations) void previewUiSound('success'); }} options={[{value:'classic',label:'原版'},{value:'bell',label:'轻铃'},{value:'soft',label:'柔和'},{value:'single',label:'轻点'}]}/>}/>
    <SettingRow title={uiText('操作反馈音')} control={<div className="mist-sound-controls"><Button size="sm" variant="quiet" disabled={!sound.operations || !sound.volume} onClick={() => void previewUiSound('success')}>{uiText('试听完成')}</Button><Button size="sm" variant="quiet" disabled={!sound.operations || !sound.volume} onClick={() => void previewUiSound('failure')}>{uiText('试听失败')}</Button><Switch ariaLabel={uiText('操作反馈音')} checked={sound.operations} onChange={value => setUiSoundPreferences({ operations: value })}/></div>}/>
    <SettingRow title={uiText('提示音量')} control={<div className="mist-sound-controls"><input type="range" aria-label={uiText('提示音量')} min="0" max="100" step="5" value={Math.round(sound.volume * 100)} onChange={event => setUiSoundPreferences({ volume: Number(event.target.value) / 100 })}/><span>{Math.round(sound.volume * 100)}%</span></div>}/>
  </>;
}
