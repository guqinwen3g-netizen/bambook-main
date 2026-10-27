import React from 'react';
import { Button, Dialog } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import { GENERATED_EXPORT_EVENT, type GeneratedExportRequest } from './exportRequests';

/** A pending export is discarded if the account, company, permission, or route changes. */
export function ExportConfirmHost({ scope }: { scope: string }) {
  const [pending, setPending] = React.useState<(GeneratedExportRequest & { scope: string }) | null>(null);
  const [error, setError] = React.useState('');
  const scopeRef = React.useRef(scope), executing = React.useRef(false); scopeRef.current = scope;
  React.useLayoutEffect(() => { executing.current = false; setPending(null); setError(''); }, [scope]);
  React.useEffect(() => {
    const receive = (raw: Event) => {
      if (raw.defaultPrevented) return;
      const request = (raw as CustomEvent<GeneratedExportRequest>).detail;
      if (!request || typeof request.run !== 'function' || typeof request.filename !== 'string') return;
      raw.preventDefault(); executing.current = false; setError(''); setPending({ ...request, scope: scopeRef.current });
    };
    document.addEventListener(GENERATED_EXPORT_EVENT, receive);
    return () => document.removeEventListener(GENERATED_EXPORT_EVENT, receive);
  }, []);
  const current = pending?.scope === scope ? pending : null;
  return <Dialog open={!!current} onClose={() => setPending(null)} title={uiText('确认导出')}
    footer={<><Button onClick={() => setPending(null)}>{uiText('取消')}</Button><Button variant="primary" onClick={() => {
      if (!current || current.scope !== scopeRef.current || executing.current) return;
      executing.current = true;
      try { current.run(); setPending(null); } catch { executing.current = false; setError(uiText('导出未能开始，请重试')); }
    }}>{uiText('导出')}</Button></>}>
    {current && <div className="mist-col" style={{ gap: 8 }}><span>{current.filename}</span><span>{current.rowCount} {uiText('条记录')}</span>{error && <span role="alert">{error}</span>}</div>}
  </Dialog>;
}
