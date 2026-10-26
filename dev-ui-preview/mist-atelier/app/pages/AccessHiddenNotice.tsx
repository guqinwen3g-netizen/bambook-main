import { uiText, ui } from '../../../../services/interfaceLanguage';
/** 服务端按当前账号岗位读权限隐藏了部分数据时的说明，避免把“看不到”误读成“没有数据/金额为零”。 */
import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { Banner } from '../../../../components/mist';
import { useMistWorkspace } from '../runtime/workspace';

export function AccessHiddenNotice({ keys }: { keys: string[] }) {
  const hidden = (useMistWorkspace().workspace?.access?.hidden ?? []).filter(item => keys.includes(item.key));
  if (!hidden.length) return null;
  return <Banner tone="neutral" icon={ShieldCheck} title={uiText("部分数据未授权")}>{hidden.map(item => item.label).join('、')}</Banner>;
}