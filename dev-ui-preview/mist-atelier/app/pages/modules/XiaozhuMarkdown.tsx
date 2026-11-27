/** 小竹回答的排版：标题、列表、表格、强调；记录编号可点开。不允许内嵌 HTML。 */
import React from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Link, Root, Text } from 'mdast';
import type { Node, Parent } from 'unist';
import { ui } from '../../../../../services/interfaceLanguage';
import { escapeSourceLabel, linkRecords, type RecordRef } from '../../runtime/xiaozhuRecords';
import type { AgentTaskTrailItem } from '../../../../../server/src/shared/mistAgentTasks';
import { taskAttachmentLabels, type TaskAttachment } from '../../../../../server/src/shared/mistTaskAttachments';

import {agentSource} from '../../runtime/agentSource';
import type {RouteTarget} from '../../nav';

const SAFE = /^(https?:|mailto:|bambook:)/i;
const ATTACHMENT_LINK = 'bambook://task-attachment';
const EMPTY_ATTACHMENTS: readonly TaskAttachment[] = [];
const EMPTY_READS: readonly AgentTaskTrailItem[] = [];
type LinkScope = {
  files: readonly TaskAttachment[];
  index: RecordRef[];
  onOpen: (view: string, id: string, target?:RouteTarget) => void;
  onOpenAttachment?: (file: TaskAttachment,pdfPage?: number) => void;
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
    const page=node?.properties['data-task-attachment-page'];
    if(file&&onOpenAttachment)return <button type="button" className="mist-xz-ref" title={typeof page==='number'?ui`第 ${page} 页`:undefined} onClick={()=>
      typeof page==='number'?onOpenAttachment(file,page):onOpenAttachment(file)}>{children}</button>;
    const hit = href?.startsWith('bambook://r/') ? index[Number(href.slice(12))] : undefined;
    if (hit) return <button type="button" className="mist-xz-ref" data-code={/\d/.test(hit.text) || undefined} onClick={() => onOpen(hit.view, hit.id)}>{children}</button>;
    const source=agentSource(href);
    if(source)return <button type="button" className="mist-xz-ref" onClick={()=>onOpen(source.view,source.id,source.target)}>{children}</button>;
    return href && /^https?:/i.test(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>;
  },
  table: ({ children }) => <div className="mist-xz-table"><table>{children}</table></div>,
};

function inlineTextStart(node:Node|undefined):string {
  if(!node)return '';
  if((node.type==='text'||node.type==='inlineCode')&&'value' in node&&typeof node.value==='string')return node.value;
  if((node.type==='strong'||node.type==='emphasis')&&'children' in node&&Array.isArray(node.children))return inlineTextStart(node.children[0]);
  return '';
}

function citedPdfPage(suffix:string,file:TaskAttachment,reads:readonly AgentTaskTrailItem[]):number|undefined {
  if(file.mimeType!=='application/pdf'&&!/\.pdf$/i.test(file.name))return;
  const scoped=suffix.replace(/^[ \t]*[：:]?[ \t]*/,'');
  const direct=/^[（(]?[ \t]*(?:第[ \t]*([1-9]\d*)[ \t]*页|page[ \t]+([1-9]\d*)\b)/i.exec(scoped);
  const lastPage=direct?null:/^共[ \t]*([1-9]\d*)[ \t]*页[；;，,][ \t]*(?:末页|最后一页)[ \t]*[（(][ \t]*第[ \t]*([1-9]\d*)[ \t]*页[ \t]*[）)]/.exec(scoped);
  const citation=direct??lastPage;
  if(!citation||lastPage&&lastPage[1]!==lastPage[2])return;
  const rest=scoped.slice(citation[0].length);
  if(/^[ \t]*[）)]?[ \t]*(?:至|到|[-~–—/,，、]|和|或|及|and\b|to\b)[ \t]*(?:第[ \t]*|pages?[ \t]+)?\d/i.test(rest))return;
  const page=Number(lastPage?lastPage[2]:citation[1]??citation[2]);
  if(!Number.isSafeInteger(page))return;
  if(reads.some(read=>read.taskAttachmentId===file.id&&read.taskAttachmentPageRange
    &&page>=read.taskAttachmentPageRange.from&&page<=read.taskAttachmentPageRange.to))return page;
}

function attachmentLinks(files: readonly TaskAttachment[],reads:readonly AgentTaskTrailItem[]) {
  const byName = new Map<string, number | undefined>();
  files.forEach((file, index) => {
    if (file.name) byName.set(file.name, byName.has(file.name) ? undefined : index);
  });
  const aliases=new Map<string,number>();
  taskAttachmentLabels(files).forEach((label,index)=>{
    if(label===files[index].name||byName.has(label))return;
    byName.set(label,index);
    aliases.set(label,index);
  });
  const toAttachment=(index:number,child:Link['children'][number],following:string):Link=>{
    const page=citedPdfPage(following,files[index],reads);
    return {type:'link',url:ATTACHMENT_LINK,data:{hProperties:{'data-task-attachment-index':index,
      ...(page!==undefined?{'data-task-attachment-page':page}:{})}},children:[child]};
  };
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp('(?<![\\p{L}\\p{N}_./\\\\-])(' + names.map(escapeSourceLabel).join('|') + ')(?:(?=第[ \\t]*[1-9])|(?![\\p{L}\\p{N}_/\\\\-]|\\.[\\p{L}\\p{N}_]))', 'gu');
  return {
    names,
    plugin: () => (tree: Root) => {
      if (!names.length) return;
      const visit = (parent: Parent, following='') => {
        const children=parent.children;
        parent.children = children.flatMap<Node>((child,position) => {
          const next=position+1<children.length?inlineTextStart(children[position+1]):following;
          if ('children' in child && Array.isArray(child.children) && child.type !== 'link' && child.type !== 'linkReference')
            visit(child as Parent,child.type==='strong'||child.type==='emphasis'?next:'');
          if(child.type==='inlineCode'&&'value' in child&&typeof child.value==='string'){
            const index=aliases.get(child.value);
            if(index!==undefined)return [toAttachment(index,{type:'inlineCode',value:child.value},next)];
          }
          if (child.type !== 'text' || !('value' in child) || typeof child.value !== 'string') return [child];
          const value = child.value, parts: (Link | Text)[] = [];
          let last = 0;
          for (const match of value.matchAll(pattern)) {
            const index = byName.get(match[0]);
            if (index === undefined) continue;
            if (match.index > last) parts.push({ type: 'text', value: value.slice(last, match.index) });
            // This marker comes from parsed text, never from a model-provided URL.
            last = match.index + match[0].length;
            parts.push(toAttachment(index,{type:'text',value:match[0]},value.slice(last)+next));
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

export function XiaozhuMarkdown({ text, index, onOpen, attachments = EMPTY_ATTACHMENTS, attachmentReads=EMPTY_READS, onOpenAttachment }: {
  text: string; index: RecordRef[]; onOpen: (view: string, id: string, target?:RouteTarget) => void;
  attachments?: readonly TaskAttachment[];
  attachmentReads?: readonly AgentTaskTrailItem[]; onOpenAttachment?: (file: TaskAttachment,pdfPage?: number) => void;
}) {
  const files = onOpenAttachment ? attachments : EMPTY_ATTACHMENTS;
  const attachment = React.useMemo(() => attachmentLinks(files,attachmentReads), [files,attachmentReads]);
  const source = React.useMemo(() => linkRecords(text, index, attachment.names), [text, index, attachment]);
  return <MarkdownLinks.Provider value={{files,index,onOpen,onOpenAttachment}}>
    <div className="mist-xz-md"><Markdown remarkPlugins={[remarkGfm, attachment.plugin]} skipHtml
      urlTransform={url => SAFE.test(url) ? url : ''} components={markdownComponents}>{source}</Markdown></div>
  </MarkdownLinks.Provider>;
}
