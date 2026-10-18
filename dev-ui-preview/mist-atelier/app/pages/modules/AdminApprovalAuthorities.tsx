/** 管理后台 · 审批资格：订单主审批负责人与供应商承诺审批人。未配置时订单无法提交审批、采购/加工合同无法提交，首日上线须先在这里办理。 */
import React from 'react';
import { Pencil, RefreshCw } from 'lucide-react';
import { Banner, Button, Card, Checkbox, DataTable, Drawer, Field, Pill, TextArea, Toolbar, useToast, type Column } from '../../../../../components/mist';
import { useMistSession } from '../../runtime/auth';
import { organizationApi, type ApprovalBusinessLine, type ApprovalCandidate, type SupplierAuthorityKind } from '../../runtime/organization';

const LINES: Array<{ value: ApprovalBusinessLine; label: string }> = [{ value: 'fabric', label: '面料' }, { value: 'garment', label: '成衣' }];
const KINDS: Array<{ value: SupplierAuthorityKind; label: string }> = [{ value: 'purchase', label: '采购合同' }, { value: 'processing', label: '加工合同' }];
const message = (e: unknown, fallback: string) => e instanceof Error ? e.message : fallback;
/** 一行 = 一项审批资格：订单（按业务域）或供应商承诺（按合同类型 × 业务域）。version 只对供应商承诺有意义。 */
type Row = { id: string; label: string; scope: string; area: 'order' | 'supplier'; line: ApprovalBusinessLine; kind?: SupplierAuthorityKind; userIds: string[]; version?: number; unavailable?: string };
type Loaded = { users: ApprovalCandidate[]; rows: Row[] };

export function AdminApprovalAuthorities() {
  const session = useMistSession(), toast = useToast();
  const [data, setData] = React.useState<Loaded | null>(null), [loading, setLoading] = React.useState(true), [error, setError] = React.useState('');
  const [editing, setEditing] = React.useState<Row | null>(null), [picked, setPicked] = React.useState<string[]>([]), [reason, setReason] = React.useState(''), [formError, setFormError] = React.useState(''), [busy, setBusy] = React.useState(false);
  const serial = React.useRef(0);
  const supplierWriter = session.hasRole('owner', 'admin') && session.hasPermission('dictionary:write');
  const load = React.useCallback(async () => {
    const run = ++serial.current; setLoading(true); setError('');
    try {
      const config = await organizationApi.orderApprovalAuthorities();
      const rows: Row[] = LINES.map(line => ({ id: 'order:' + line.value, label: line.label + '订单', scope: '订单主审批 · 须持有订单写入权限', area: 'order', line: line.value, userIds: config.assignments.filter(a => a.businessLine === line.value).map(a => a.userId) }));
      for (const kind of KINDS) for (const line of LINES) {
        const base = { id: 'supplier:' + kind.value + ':' + line.value, label: line.label + kind.label, scope: '供应商承诺审批 · 须持有采购审批权限', area: 'supplier' as const, line: line.value, kind: kind.value };
        try { const { item } = await organizationApi.supplierApprovalAuthority(kind.value, line.value); rows.push({ ...base, userIds: item.userIds, version: item.version }); }
        catch (e) { rows.push({ ...base, userIds: [], unavailable: message(e, '读取失败') }); }
      }
      if (run === serial.current) setData({ users: config.users, rows });
    } catch (e) { if (run === serial.current) setError(message(e, '审批资格读取失败')); }
    finally { if (run === serial.current) setLoading(false); }
  }, []);
  React.useEffect(() => { setData(null); void load(); return () => { serial.current++; }; }, [session.sessionKey, load]);

  const name = (id: string) => data?.users.find(u => u.id === id)?.displayName ?? id;
  const canEdit = (row: Row) => !row.unavailable && (row.area === 'order' || supplierWriter);
  const open = (row: Row) => { setEditing(row); setPicked(row.userIds); setReason(''); setFormError(''); };
  const save = async () => {
    if (!editing) return;
    if (editing.area === 'supplier' && !reason.trim()) { setFormError('请填写配置理由'); return; }
    setBusy(true); setFormError('');
    try {
      if (editing.area === 'order') await organizationApi.setOrderApprovalAuthorities(editing.line, picked);
      else await organizationApi.setSupplierApprovalAuthority(editing.kind!, editing.line, { requestKey: 'supplier-authority:' + crypto.randomUUID(), userIds: picked, expectedConfigVersion: editing.version ?? 0, reason: reason.trim() });
      toast(editing.label + '审批人已保存'); setEditing(null); await load();
    } catch (e) { setFormError(message(e, '审批资格保存失败')); }
    finally { setBusy(false); }
  };
  const missing = data?.rows.filter(row => !row.unavailable && !row.userIds.length) ?? [];
  const columns: Column<Row>[] = [
    { key: 'label', header: '审批事项', width: 'minmax(180px,1.4fr)', render: row => <><b>{row.label}</b><div className="mist-note">{row.scope}</div></> },
    { key: 'users', header: '审批人', width: 'minmax(220px,2fr)', render: row => row.unavailable ? <span className="mist-note">{row.unavailable}</span> : row.userIds.length ? row.userIds.map(name).join('、') : <span className="mist-note">未配置</span> },
    { key: 'status', header: '状态', width: '96px', render: row => row.unavailable ? <Pill tone="neutral">不可读取</Pill> : row.userIds.length ? <Pill tone="ok">已配置</Pill> : <Pill tone="warn">未配置</Pill> },
    { key: 'version', header: '配置版本', width: '96px', hideOnMobile: true, render: row => row.version === undefined ? <span className="mist-note">—</span> : String(row.version) },
    { key: 'action', header: '', width: '96px', align: 'right', render: row => <Button size="sm" icon={Pencil} disabled={!canEdit(row)} onClick={() => open(row)} aria-label={'调整' + row.label + '审批人'}>调整</Button> },
  ];
  return <>
    <Toolbar right={<Button icon={RefreshCw} loading={loading} onClick={() => void load()}>重新读取</Button>}>
      <span className="mist-note">审批人仍须持有相应岗位权限，服务器保存与审批时复核。</span>
    </Toolbar>
    {error && <Banner tone="bad" title="审批资格读取失败">{error}</Banner>}
    {missing.length > 0 && <Banner tone="warn" title={'尚有 ' + missing.length + ' 项审批资格未配置'}>{missing.map(row => row.label).join('、')}在配置前无法提交审批。</Banner>}
    {data && !supplierWriter && <Banner tone="neutral" title="供应商承诺审批人仅老板或管理员可修改">当前账号可调整订单审批负责人；供应商承诺审批人须由持有数据字典写入权限的老板或管理员办理。</Banner>}
    <Card><DataTable ariaLabel="审批资格" rows={data?.rows ?? []} rowKey={row => row.id} loading={loading && !data} columns={columns} /></Card>
    <Drawer open={!!editing} onClose={() => !busy && setEditing(null)} title={editing ? '调整' + editing.label + '审批人' : ''} sub={editing?.scope}
      footer={<div className="mist-row"><Button variant="primary" loading={busy} onClick={() => void save()}>保存</Button><Button disabled={busy} onClick={() => setEditing(null)}>取消</Button></div>}>
      <div className="mist-col">
      {formError && <Banner tone="bad" title="未保存">{formError}</Banner>}
      <div className="mist-col" role="group" aria-label={(editing?.label ?? '') + '审批人'}>{[...(data?.users ?? [])].sort((a, b) => Number(editing?.userIds.includes(b.id)) - Number(editing?.userIds.includes(a.id))).map(user =>
        <Checkbox key={user.id} label={user.displayName} checked={picked.includes(user.id)} disabled={busy}
          onChange={on => setPicked(on ? [...picked, user.id] : picked.filter(id => id !== user.id))} />)}</div>
      {editing?.area === 'supplier' && <Field label="配置理由" required full><TextArea value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></Field>}
      </div>
    </Drawer>
  </>;
}
