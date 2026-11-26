/** 小竹回答的排版：标题、列表、表格、强调；记录编号可点开。不允许内嵌 HTML。 */
import React from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Link, Root, Text } from 'mdast';
import type { Node, Parent } from 'unist';
import { escapeSourceLabel, linkRecords, type RecordRef } from '../../runtime/xiaozhuRecords';
import type { TaskAttachment } from '../../../../../server/src/shared/mistTaskAttachments';

import {agentSource} from '../../runtime/agentSource';
import type {RouteTarget} from '../../nav';

const SAFE = /^(https?:|mailto:|bambook:)/i;
const ATTACHMENT_LINK = 'bambook://task-attachment';
const EMPTY_ATTACHMENTS: readonly TaskAttachment[] = [];
type LinkScope = {
  files: readonly TaskAttachment[];
  index: RecordRef[];
  onOpen: (view: string, id: string, target?:RouteTarget) => void;
  onOpenAttachment?: (file: TaskAttachment) => void;
};
const MarkdownLinks = React.createContext<LinkScope | null>(null);
const markdownComponents: Components = {
  // Attachment-derived Markdown must not initiate requests to a model-supplied image host.
  img: ({alt}) => <span>{alt}</span>,
  a: function SourceLink({href, children, node}) {
    const links = React.useContext(MarkdownLinks);
    if (!links) return <>{children}</>;
    const {files, index, onOpen, onOpenAttachment} = links;
    const fileIndex = node?.properties['data-task-attachment-index'];
    const file = href === ATTACHMENT_LINK && typeof fileIndex === 'number' ? files[fileIndex] : undefined;
    if (file && onOpenAttachment) return <button type="button" className="mist-xz-ref" onClick={() => onOpenAttachment(file)}>{children}</button>;
    const hit = href?.startsWith('bambook://r/') ? index[Number(href.slice(12))] : undefined;
    if (hit) return <button type="button" className="mist-xz-ref" data-code={/\d/.test(hit.text) || undefined} onClick={() => onOpen(hit.view, hit.id)}>{children}</button>;
    const source=agentSource(href);
    if(source)return <button type="button" className="mist-xz-ref" onClick={()=>onOpen(source.view,source.id,source.target)}>{children}</button>;
    return href && /^https?:/i.test(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>;
  },
  table: ({ children }) => <div className="mist-xz-table"><table>{children}</table></div>,
};

function attachmentLinks(files: readonly TaskAttachment[]) {
  const byName = new Map<string, number | undefined>();
  files.forEach((file, index) => {
    if (file.name) byName.set(file.name, byName.has(file.name) ? undefined : index);
  });
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp('(?<![\\p{L}\\p{N}_./\\\\-])(' + names.map(escapeSourceLabel).join('|') + ')(?![\\p{L}\\p{N}_/\\\\-]|\\.[\\p{L}\\p{N}_])', 'gu');
  return {
    names,
    plugin: () => (tree: Root) => {
      if (!names.length) return;
      const visit = (parent: Parent) => {
        parent.children = parent.children.flatMap<Node>(child => {
          if ('children' in child && Array.isArray(child.children) && child.type !== 'link' && child.type !== 'linkReference') visit(child as Parent);
          if (child.type !== 'text' || !('value' in child) || typeof child.value !== 'string') return [child];
          const value = child.value, parts: (Link | Text)[] = [];
          let last = 0;
          for (const match of value.matchAll(pattern)) {
            const index = byName.get(match[0]);
            if (index === undefined) continue;
            if (match.index > last) parts.push({ type: 'text', value: value.slice(last, match.index) });
            // This marker comes from parsed text, never from a model-provided URL.
            parts.push({
              type: 'link', url: ATTACHMENT_LINK,
              data: { hProperties: { 'data-task-attachment-index': index } },
              children: [{ type: 'text', value: match[0] }],
            });
            last = match.index + match[0].length;
          }
          if (!parts.length) return [child];
          if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
          return parts;
        });
      };
      visit(tree);
    },
  };
}

export function XiaozhuMarkdown({ text, index, onOpen, attachments = EMPTY_ATTACHMENTS, onOpenAttachment }: {
  text: string; index: RecordRef[]; onOpen: (view: string, id: string, target?:RouteTarget) => void;
  attachments?: readonly TaskAttachment[]; onOpenAttachment?: (file: TaskAttachment) => void;
}) {
  const files = onOpenAttachment ? attachments : EMPTY_ATTACHMENTS;
  const attachment = React.useMemo(() => attachmentLinks(files), [files]);
  const source = React.useMemo(() => linkRecords(text, index, attachment.names), [text, index, attachment]);
  return <MarkdownLinks.Provider value={{files,index,onOpen,onOpenAttachment}}>
    <div className="mist-xz-md"><Markdown remarkPlugins={[remarkGfm, attachment.plugin]} skipHtml
      urlTransform={url => SAFE.test(url) ? url : ''} components={markdownComponents}>{source}</Markdown></div>
  </MarkdownLinks.Provider>;
}
