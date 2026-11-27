/** 小竹回答的排版：标题、列表、表格、强调；记录编号可点开。不允许内嵌 HTML。 */
import React from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Link, Paragraph, Root, Text } from 'mdast';
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
  onOpenAttachment?: (file: TaskAttachment,target?: number | string) => void;
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
    const page=node?.properties['data-task-attachment-page'],sheet=node?.properties['data-task-attachment-sheet'];
    const target=typeof page==='number'?page:typeof sheet==='string'?sheet:undefined;
    const title=typeof target==='number'?ui`第 ${target} 页`:typeof target==='string'?ui`工作表 ${target}`:undefined;
    if(file&&onOpenAttachment)return <button type="button" className="mist-xz-ref" title={title}
      onClick={()=>target===undefined?onOpenAttachment(file):onOpenAttachment(file,target)}>{children}</button>;
    const hit = href?.startsWith('bambook://r/') ? index[Number(href.slice(12))] : undefined;
    if (hit) return <button type="button" className="mist-xz-ref" data-code={/\d/.test(hit.text) || undefined} onClick={() => hit.target ? onOpen(hit.view, hit.id, hit.target) : onOpen(hit.view, hit.id)}>{children}</button>;
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

const PDF_PAGE_REFERENCE = /^(?:第[ \t]*([1-9]\d*)[ \t]*页|page[ \t]+([1-9]\d*)\b)/i;

function singleLabel(node: Node): string {
  if ('value' in node && (node.type === 'text' || node.type === 'inlineCode') && typeof node.value === 'string') return node.value;
  if ('children' in node && Array.isArray(node.children) && node.children.length === 1
    && ['heading', 'paragraph', 'strong', 'emphasis'].includes(node.type)) return singleLabel(node.children[0]);
  return '';
}

const ATTACHMENT_EXT_IN_PROSE = /\.(?:pdf|xlsx)(?![a-z0-9_-])/i;
type CitationPageRange = {from:number;to:number};

function mentionsAnotherSource(node: Node): boolean {
  if (node.type === 'link' || node.type === 'linkReference') return true;
  if ('value' in node && typeof node.value === 'string') return ATTACHMENT_EXT_IN_PROSE.test(node.value);
  return 'children' in node && Array.isArray(node.children) && node.children.some(mentionsAnotherSource);
}

function citedPdfPage(suffix:string,file:TaskAttachment,reads:readonly AgentTaskTrailItem[]):number|undefined {
  if(file.mimeType!=='application/pdf'&&!/\.pdf$/i.test(file.name))return;
  const scoped=suffix.replace(/^[ \t]*[：:]?[ \t]*/,'');
  const prefix = /^[（(]?[ \t]*/.exec(scoped)?.[0].length ?? 0;
  const direct = PDF_PAGE_REFERENCE.exec(scoped.slice(prefix));
  const lastPage=direct?null:/^共[ \t]*([1-9]\d*)[ \t]*页[；;，,][ \t]*(?:末页|最后一页)[ \t]*[（(][ \t]*第[ \t]*([1-9]\d*)[ \t]*页[ \t]*[）)]/.exec(scoped);
  const citation=direct??lastPage;
  if(!citation||lastPage&&lastPage[1]!==lastPage[2])return;
  const rest=scoped.slice(citation[0].length+(direct?prefix:0));
  if(/^[ \t]*[）)]?[ \t]*(?:至|到|[-~–—/,，、]|和|或|及|and\b|to\b)[ \t]*(?:第[ \t]*|pages?[ \t]+)?\d/i.test(rest))return;
  const page=Number(lastPage?lastPage[2]:citation[1]??citation[2]);
  if(!Number.isSafeInteger(page))return;
  if(reads.some(read=>read.taskAttachmentId===file.id&&(
    read.taskAttachmentObservedPages?.includes(page)
    ?? (read.taskAttachmentPageRange&&page>=read.taskAttachmentPageRange.from&&page<=read.taskAttachmentPageRange.to)
  )))return page;
}

const WORKSHEET_REFERENCE = /^(?:工作表|worksheet)(?:[ \t]*[：:][ \t]*|[ \t]+)/i;

function observedWorksheet(text:string,file:TaskAttachment,reads:readonly AgentTaskTrailItem[],boundary:RegExp):string|undefined {
  if(!/\.xlsx$/i.test(file.name)&&!/spreadsheetml\.sheet/i.test(file.mimeType))return;
  const names=reads.filter(read=>read.taskAttachmentId===file.id).flatMap(read=>read.taskAttachmentObservedSheets??[]);
  return names.sort((a,b)=>b.length-a.length).find(name=>text.startsWith(name)&&boundary.test(text.slice(name.length)));
}

function citedSheet(suffix:string,file:TaskAttachment,reads:readonly AgentTaskTrailItem[]):string|undefined {
  const prefix=/^[ \t]*[（(][ \t]*/.exec(suffix);
  if(!prefix)return;
  const reference=suffix.slice(prefix[0].length);
  const syntax=WORKSHEET_REFERENCE.exec(reference);
  if(syntax)return observedWorksheet(reference.slice(syntax[0].length),file,reads,/^[ \t]*[）)]/);
}

type ReportInline = Paragraph['children'][number];

/** Split report lines without turning soft breaks into visible hard breaks or discarding styling. */
function splitSectionLines(children: ReportInline[]) {
  const lines: ReportInline[][] = [[]], separators: ReportInline[] = [];
  const separate = (separator: ReportInline) => {
    separators.push(separator);
    lines.push([]);
  };
  for (const child of children) {
    if (child.type === 'break') {
      separate(child);
    } else if (child.type === 'text' && child.value.includes('\n')) {
      child.value.split('\n').forEach((value,index)=>{
        if(index>0)separate({type:'text',value:'\n'});
        if(value)lines.at(-1)!.push({type:'text',value});
      });
    } else if (child.type === 'strong' || child.type === 'emphasis') {
      const nested=splitSectionLines(child.children);
      if(!nested.separators.length){lines.at(-1)!.push(child);continue;}
      nested.lines.forEach((items,index)=>{
        if(index>0)separate(nested.separators[index-1]);
        if(items.length)lines.at(-1)!.push({...child,children:items});
      });
    } else {
      lines.at(-1)!.push(child);
    }
  }
  return {lines,separators};
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
  const toAttachment=(index:number,child:Link['children'][number],following:string,target?:number|string):Link=>{
    const page=typeof target==='number'?target:citedPdfPage(following,files[index],reads);
    const sheet=typeof target==='string'?target:citedSheet(following,files[index],reads);
    return {type:'link',url:ATTACHMENT_LINK,data:{hProperties:{'data-task-attachment-index':index,
      ...(page!==undefined?{'data-task-attachment-page':page}:{}),
      ...(sheet!==undefined?{'data-task-attachment-sheet':sheet}:{})}},children:[child]};
  };
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp('(?<![\\p{L}\\p{N}_./\\\\-])(' + names.map(escapeSourceLabel).join('|') + ')(?:(?=第[ \\t]*[1-9])|(?![\\p{L}\\p{N}_/\\\\-]|\\.[\\p{L}\\p{N}_]))', 'gu');
  const observedReads = reads.filter(read => read.taskAttachmentObservedPages !== undefined);
  const readLead = (heading:Root['children'][number]) => {
    if (heading.type !== 'paragraph') return;
    const parts=heading.children.map(singleLabel);
    if(parts.some(part=>!part||part.includes('\n')))return;
    const sentence=parts.join('').trim();
    const [mention,other]=sentence.matchAll(pattern);
    if(!mention||other)return;
    const index=byName.get(mention[0]);
    if(index===undefined||!/^application\/pdf\b/i.test(files[index].mimeType)&&!/\.pdf$/i.test(files[index].name))return;
    const prefix=sentence.slice(0,mention.index).trim();
    const suffix=sentence.slice(mention.index+mention[0].length);
    const readInChinese=/^(?:本次[ \t]*)?已(?:按(?:指定|所选)范围)?(?:只|仅)?(?:读取|读到|核对|摘录)(?:了)?$/u.test(prefix);
    const readInEnglish=/^(?:I|We)[ \t]+(?:read|checked|reviewed)$/i.test(prefix);
    if((!readInChinese&&!readInEnglish)||ATTACHMENT_EXT_IN_PROSE.test(suffix))return;
    const bounds=readInChinese
      ? /^[ \t]*(?:的[ \t]*)?第[ \t]*([1-9]\d*)(?:[ \t]*(?:至|到|[-–—])[ \t]*第?[ \t]*([1-9]\d*))?[ \t]*页/u.exec(suffix)
      : /^[ \t]+pages?[ \t]+([1-9]\d*)(?:[ \t]*(?:to|[-–—])[ \t]*([1-9]\d*))?\b/i.exec(suffix);
    if(!bounds||!/^[ \t]*(?:[.。；;：:，,]|$)/u.test(suffix.slice(bounds[0].length)))return;
    const from=Number(bounds[1]),to=Number(bounds[2]??bounds[1]);
    if(Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&from<=to)return {index,range:{from,to}};
  };
  const linkSectionLine = (paragraph: Paragraph, index: number, range?:CitationPageRange) => {
    const first = paragraph.children[0];
    const container = first?.type === 'strong' || first?.type === 'emphasis' ? first : paragraph;
    const start = container.children[0];
    if (start?.type !== 'text') return;
    const suffixContainer = container.children.length>1 ? container : paragraph;
    const following = suffixContainer.children[1];
    const next = inlineTextStart(following) + inlineTextStart(suffixContainer.children[2])
      + (suffixContainer !== paragraph ? inlineTextStart(paragraph.children[1]) : '');
    const file = files[index], text = start.value;
    const pageLabel = PDF_PAGE_REFERENCE.exec(text)?.[0];
    const page = pageLabel ? citedPdfPage(text+next,file,observedReads) : undefined;
    if(page!==undefined&&range&&(page<range.from||page>range.to))return;
    const sheetPrefix = WORKSHEET_REFERENCE.exec(text)?.[0];
    const sheet = sheetPrefix ? observedWorksheet((text+next).slice(sheetPrefix.length),file,reads,/^[ \t]*(?:$|[：:。])/u) : undefined;
    if (sheet && sheetPrefix === text && following && singleLabel(following) === sheet) {
      suffixContainer.children.splice(1,1,toAttachment(index,following,'',sheet));
      return;
    }
    const label = page !== undefined ? pageLabel : sheet ? sheetPrefix+sheet : undefined;
    if (!label || !text.startsWith(label)) return;
    const remainder = text.slice(label.length);
    container.children.splice(0,1,toAttachment(index,{type:'text',value:label},'',page??sheet),
      ...(remainder ? [{type:'text' as const,value:remainder}] : []));
  };
  const linkSectionReference = (paragraph: Paragraph, index: number, range?:CitationPageRange) => {
    const {lines,separators}=splitSectionLines(paragraph.children);
    let sameSource=true, continuedRange=false;
    paragraph.children=lines.flatMap((children,position)=>{
      const line:Paragraph={type:'paragraph',children};
      if(mentionsAnotherSource(line))sameSource=false;
      const text=children.map(inlineTextStart).join('');
      const page=PDF_PAGE_REFERENCE.exec(text);
      const rangeContinues=!!page&&/^[ \t]*[）)]?[ \t]*(?:至|到|[-~–—/,，、]|和|或|及|and|to)[ \t]*$/i.test(text.slice(page[0].length));
      if(sameSource&&!continuedRange&&!rangeContinues)linkSectionLine(line,index,range);
      continuedRange=rangeContinues;
      return position===0?line.children:[separators[position-1],...line.children];
    });
  };
  return {
    names,
    plugin: () => (tree: Root) => {
      if (!names.length) return;
      for (let position=1;position<tree.children.length;position++) {
        const heading = tree.children[position-1];
        if (heading.type !== 'heading' && heading.type !== 'paragraph') continue;
        const lead = readLead(heading);
        const index = lead?.index ?? byName.get(singleLabel(heading).trim().replace(/[：:]$/,'').trim());
        if (index === undefined) continue;
        const details = tree.children[position];
        if (details.type === 'paragraph') linkSectionReference(details,index,lead?.range);
        if (details.type === 'list') {
          for (const item of details.children) {
            const paragraph = item.children[0];
            if (paragraph?.type !== 'paragraph') continue;
            if (lead && mentionsAnotherSource(paragraph)) break;
            linkSectionReference(paragraph,index,lead?.range);
          }
        }
      }
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
  attachmentReads?: readonly AgentTaskTrailItem[]; onOpenAttachment?: (file: TaskAttachment,target?: number | string) => void;
}) {
  const files = onOpenAttachment ? attachments : EMPTY_ATTACHMENTS;
  const attachment = React.useMemo(() => attachmentLinks(files,attachmentReads), [files,attachmentReads]);
  const source = React.useMemo(() => linkRecords(text, index, attachment.names), [text, index, attachment]);
  return <MarkdownLinks.Provider value={{files,index,onOpen,onOpenAttachment}}>
    <div className="mist-xz-md"><Markdown remarkPlugins={[remarkGfm, attachment.plugin]} skipHtml
      urlTransform={url => SAFE.test(url) ? url : ''} components={markdownComponents}>{source}</Markdown></div>
  </MarkdownLinks.Provider>;
}
