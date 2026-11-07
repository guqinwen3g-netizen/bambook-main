/** 被动 AI 入口的「完整版」：把当前问题带进小竹页，不在业务页另开对话。 */
import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../../../../../components/mist';
import { uiText } from '../../../../../services/interfaceLanguage';
import { useAssistantConversation } from '../../runtime/assistantConversation';
import { useMistSession } from '../../runtime/auth';
import { useMistWorkspace } from '../../runtime/workspace';
import { useNav } from '../../nav';

export function XiaozhuLink({ question }: { question: string }) {
  const session = useMistSession(), { workspace } = useMistWorkspace(), { go } = useNav();
  const conversation = useAssistantConversation(session.sessionKey + ':' + (workspace?.id ?? ''));
  if (!session.hasPermission('ai:chat')) return null;
  return <Button size="sm" variant="quiet" iconRight={ArrowRight} onClick={() => { conversation.setQuestion(question); go('assistant'); }}>{uiText('完整版')}</Button>;
}
