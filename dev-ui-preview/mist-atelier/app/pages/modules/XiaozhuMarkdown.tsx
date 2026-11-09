/** 小竹回答的排版：标题、列表、表格、强调；记录编号可点开。不允许内嵌 HTML。 */
import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { linkRecords, type RecordRef } from '../../runtime/xiaozhuRecords';

const SAFE = /^(https?:|mailto:|bambook:)/i;
export function XiaozhuMarkdown({ text, index, onOpen }: { text: string; index: RecordRef[]; onOpen: (view: string, id: string) => void }) {
  const source = React.useMemo(() => linkRecords(text, index), [text, index]);
  return <div className="mist-xz-md"><Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => SAFE.test(url) ? url : ''} components={{
    a: ({ href, children }) => {
      const hit = href?.startsWith('bambook://r/') ? index[Number(href.slice(12))] : undefined;
      if (hit) return <button type="button" className="mist-xz-ref" data-code={/\d/.test(hit.text) || undefined} onClick={() => onOpen(hit.view, hit.id)}>{children}</button>;
      return href && /^https?:/i.test(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>;
    },
    table: ({ children }) => <div className="mist-xz-table"><table>{children}</table></div>,
  }}>{source}</Markdown></div>;
}
