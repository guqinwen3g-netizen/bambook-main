import React from 'react';
import { createMistState, type MistCommand, type MistWorkspaceEnvelope } from '../../../../server/src/shared/mistWorkspace';
import type { CompanySettingsSnapshot } from '../../../../server/src/platform/companySettings';
import { platformAdminApi } from '../runtime/platformAdmin';
import { useMistSession } from '../runtime/auth';
import { MistWorkspaceScope, useMistWorkspace } from '../runtime/workspace';
import { SettingsPage } from './SettingsPage';

/** Company settings retain the existing form; the platform API returns only configuration and its history. */
export function PlatformCompanySettingsPage() {
  const session = useMistSession(), parent = useMistWorkspace();
  const companyId = session.user?.platformCompany?.companyId;
  const key = `${session.sessionKey}:${companyId ?? ''}`, current = React.useRef(key); current.current = key;
  const [data, setData] = React.useState<{ key: string; snapshot: CompanySettingsSnapshot } | null>(null);
  const [loading, setLoading] = React.useState(true), [saving, setSaving] = React.useState(false), [error, setError] = React.useState('');
  const active = data?.key === key ? data.snapshot : null;
  const snapshot = React.useRef(active); snapshot.current = active;
  const refresh = React.useCallback(async (signal?: AbortSignal) => {
    if (!companyId) return;
    const scope = key; setLoading(true); setError('');
    try {
      const result = await platformAdminApi.companySettings(companyId, signal);
      if (result.snapshot?.companyId !== companyId) throw new Error('公司范围不一致，请重新读取');
      if (current.current === scope && !signal?.aborted) setData({ key: scope, snapshot: result.snapshot });
    } catch (failure) {
      if (current.current === scope && !signal?.aborted) setError(failure instanceof Error ? failure.message : '公司设置读取失败');
    } finally { if (current.current === scope && !signal?.aborted) setLoading(false); }
  }, [companyId, key]);
  React.useEffect(() => { setData(null); setSaving(false); const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);
  const run = async (command: MistCommand) => {
    if (command.type !== 'settings.update' || !companyId || !snapshot.current) throw new Error('公司设置尚未就绪');
    const scope = key; setSaving(true); setError('');
    try {
      const input = { requestId: crypto.randomUUID(), expectedRevision: snapshot.current.revision, patch: command.payload };
      const result = await platformAdminApi.saveCompanySettings(companyId, input);
      if (result.snapshot?.companyId !== companyId || result.receipt?.requestId !== input.requestId || result.receipt.revision !== input.expectedRevision + 1 || result.snapshot.revision < result.receipt.revision) throw new Error('保存回执不一致，请重新读取核对');
      if (current.current === scope) setData({ key: scope, snapshot: result.snapshot });
      return result.receipt;
    } finally { if (current.current === scope) setSaving(false); }
  };
  const state = React.useMemo(() => {
    if (!active) return null;
    const empty = createMistState({ id: () => crypto.randomUUID(), now: new Date().toISOString(), actorName: session.user?.displayName ?? '', can: () => false }, 'empty');
    empty.settings = { ...empty.settings, ...active.settings }; empty.events = active.events;
    return empty;
  }, [active, session.user?.displayName]);
  const workspace: MistWorkspaceEnvelope | null = active && state ? { id: active.workspaceId ?? `settings:${active.companyId}`, ownerId: active.ownerId ?? '', name: active.settings.workspaceName, revision: active.revision, state, access: { role: 'owner', canManageMembers: false, hidden: [] } } : null;
  return <MistWorkspaceScope value={{ ...parent, state, workspace, workspaces: [], loading, saving, error, pending: null, pendingCreate: null, commandRecovery: null, run, refresh: () => refresh() }}><SettingsPage /></MistWorkspaceScope>;
}
