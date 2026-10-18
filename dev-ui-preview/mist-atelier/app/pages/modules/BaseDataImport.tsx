/** 基础资料批量导入：下载模板 → 选择 Excel/CSV → 预览 → 整批导入（任何一行不通过则不导入）。 */
import React from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { Banner, Button, Drawer } from '../../../../../components/mist';
import { MIST_IMPORT_FIELDS, MIST_IMPORT_KIND_LABEL, MIST_IMPORT_MAX_ROWS, mistImportHeaderKey, type MistImportKind } from '../../../../../server/src/shared/mistImport';
import { useMistWorkspace } from '../../runtime/workspace';

type Parsed = { rows: Array<Record<string, string>>; ignored: string[]; missing: string[]; file: string };
const cell = (value: unknown): string => {
  if (value instanceof Date) { const d = new Date(value.getTime() - value.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); }
  return value == null ? '' : String(value).trim();
};

/** 把表格（首个工作表，首行为表头）解析为导入行；空行跳过并保留原行号。 */
export function parseImportTable(kind: MistImportKind, table: unknown[][], file = ''): Parsed {
  const [header = [], ...body] = table;
  const keys = header.map(h => mistImportHeaderKey(kind, cell(h)));
  const ignored = header.map(cell).filter((h, i) => h && !keys[i]);
  const missing = MIST_IMPORT_FIELDS[kind].filter(f => f.required && !keys.includes(f.key)).map(f => f.label);
  const rows = body.flatMap((line, index) => {
    const row: Record<string, string> = {};
    keys.forEach((key, i) => { if (key) row[key] = cell(line?.[i]); });
    return Object.values(row).some(Boolean) ? [{ ...row, __row: String(index + 2) }] : [];
  });
  return { rows, ignored, missing, file };
}

async function downloadTemplate(kind: MistImportKind) {
  const XLSX = await import('xlsx');
  const fields = MIST_IMPORT_FIELDS[kind];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([fields.map(f => f.label + (f.required ? '*' : ''))]), MIST_IMPORT_KIND_LABEL[kind]);
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['列名', '必填', '说明', '示例'], ...fields.map(f => [f.label, f.required ? '是' : '', f.hint || '', f.example])]), '填写说明');
  XLSX.writeFile(book, `${MIST_IMPORT_KIND_LABEL[kind]}导入模板.xlsx`);
}

async function readFile(kind: MistImportKind, file: File): Promise<Parsed> {
  const XLSX = await import('xlsx');
  const data = new Uint8Array(await file.arrayBuffer());
  const book = /\.csv$/i.test(file.name) ? XLSX.read(new TextDecoder('utf-8').decode(data).replace(/^\uFEFF/, ''), { type: 'string', cellDates: true }) : XLSX.read(data, { type: 'array', cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error('文件里没有工作表');
  return parseImportTable(kind, XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' }), file.name);
}

export function BaseDataImportButton({ kind, disabled, label: buttonLabel = '批量导入' }: { kind: MistImportKind; disabled?: boolean; label?: string }) {
  const workspace = useMistWorkspace();
  const [open, setOpen] = React.useState(false), [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [done, setDone] = React.useState('');
  const input = React.useRef<HTMLInputElement>(null);
  const label = MIST_IMPORT_KIND_LABEL[kind], fields = MIST_IMPORT_FIELDS[kind];
  const close = () => { if (busy) return; setOpen(false); setParsed(null); setError(''); setDone(''); };
  const choose = async (file?: File) => {
    if (!file) return; setError(''); setDone('');
    try { setParsed(await readFile(kind, file)); } catch (problem) { setParsed(null); setError(problem instanceof Error ? problem.message : '文件读取失败'); }
  };
  const blocked = !parsed ? '请先选择文件' : parsed.missing.length ? `缺少必填列：${parsed.missing.join('、')}` : !parsed.rows.length ? '文件没有数据行' : parsed.rows.length > MIST_IMPORT_MAX_ROWS ? `一次最多 ${MIST_IMPORT_MAX_ROWS} 行，请分批` : busy || workspace.pending ? '正在处理' : '';
  const submit = async () => {
    if (blocked || !parsed) return; setBusy(true); setError('');
    try { const receipt = await workspace.run(kind === 'openingReceivable' ? { type: 'opening.receivable.import', payload: { rows: parsed.rows } } : kind === 'openingPayable' ? { type: 'opening.payable.import', payload: { rows: parsed.rows } } : { type: 'market.import', payload: { kind, rows: parsed.rows } }); const count = (receipt as { result?: { imported?: number } })?.result?.imported ?? parsed.rows.length; setDone(`已导入 ${count} 条${label}`); setParsed(null); }
    catch (problem) { setError(problem instanceof Error ? problem.message : '导入未完成'); }
    finally { setBusy(false); }
  };
  const preview = parsed?.rows.slice(0, 5) || [], shown = fields.filter(f => preview.some(r => r[f.key])).slice(0, 6);
  return <>
    <Button icon={Upload} disabled={disabled} onClick={() => setOpen(true)}>{buttonLabel}</Button>
    <Drawer open={open} onClose={close} title={`批量导入${label}`} sub={kind === 'openingReceivable' ? '登记系统启用前已开票、仍未收回的客户欠款；整批校验，全部通过才导入' : kind === 'openingPayable' ? '登记系统启用前已收票、仍未付清的供应商票据；整批校验，全部通过才导入' : '上线时一次录入现有资料；整批校验，全部通过才导入'}
      footer={<><Button onClick={close} disabled={busy}>关闭</Button><Button variant="primary" disabled={!!blocked} onClick={() => void submit()}>{parsed?.rows.length ? `导入 ${parsed.rows.length} 行` : '导入'}</Button></>}>
      <ol className="mist-import-steps" style={{ display: 'grid', gap: 12, margin: 0, paddingLeft: 18 }}>
        <li>下载模板，按“填写说明”逐行填写（带 * 的列必填）。也可直接用已有表格，只要表头与模板列名一致。<div style={{ marginTop: 6 }}><Button icon={FileSpreadsheet} onClick={() => void downloadTemplate(kind)}>下载{label}模板</Button></div></li>
        <li>选择填好的 Excel（.xlsx）或 CSV（UTF-8）文件，读取第一个工作表。<div style={{ marginTop: 6 }}><Button icon={Upload} disabled={busy} onClick={() => input.current?.click()}>选择文件</Button>{parsed && <span style={{ marginLeft: 8 }}>{parsed.file} · {parsed.rows.length} 行</span>}</div>
          <input ref={input} hidden type="file" accept=".xlsx,.xls,.csv" aria-label={`${label}导入文件`} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file); }} /></li>
        <li>核对预览后导入。编码重复、必填缺失、负责人或供应商对不上时整批不导入，并逐行列出原因，改好后重新选择文件即可。</li>
      </ol>
      {kind === 'product' && <p style={{ marginTop: 12 }}>产品关联供应商时，请先导入供应商。</p>}
      {kind === 'openingPayable' && <p style={{ marginTop: 12 }}>请先导入供应商。每张供应商发票一行，只填截至启用日仍未付的余额；已付清的不必登记。之后按票据照常申请付款、登记付款分配，计入应付账龄与期末调汇。启用前的出口退税不在本系统申报。</p>}
      {kind === 'openingReceivable' && <p style={{ marginTop: 12 }}>请先导入客户。每张发票一行，只填截至启用日仍未收回的余额；已收清的不必登记。之后到账照常在“收款与核销”核销，催收、对账单、账龄与期末调汇一并计入。</p>}
      {parsed?.ignored.length ? <Banner tone="warn" title="以下列不在模板中，将被忽略">{parsed.ignored.join('、')}</Banner> : null}
      {parsed && blocked && !busy && <Banner tone="warn" title={blocked} />}
      {preview.length > 0 && shown.length > 0 && <div style={{ marginTop: 12, overflowX: 'auto' }}><table className="mist-mini-table" aria-label="导入预览" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>行</th>{shown.map(f => <th key={f.key} style={{ textAlign: 'left' }}>{f.label}</th>)}</tr></thead>
        <tbody>{preview.map(r => <tr key={r.__row}><td>{r.__row}</td>{shown.map(f => <td key={f.key}>{r[f.key]}</td>)}</tr>)}</tbody>
      </table>{parsed!.rows.length > preview.length && <small>仅显示前 {preview.length} 行</small>}</div>}
      {error && <Banner tone="bad" title="导入未执行"><span style={{ whiteSpace: 'pre-wrap' }}>{error}</span></Banner>}
      {done && <Banner tone="ok" title={done} />}
    </Drawer>
  </>;
}
