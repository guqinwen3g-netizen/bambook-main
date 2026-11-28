/** Limits for a single personal Agent message. */
export const TASK_ATTACHMENT_COUNT = 6;
export const PDF_VISUAL_PAGE_LIMIT = 3;
export type PdfVisualCandidate = {fileId:string;from:number;to:number};
export type TaskAttachmentRef = { taskId: string; fileId: string };
export const TASK_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const TASK_ATTACHMENT_TOTAL_BYTES = 24 * 1024 * 1024;
export const TASK_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.pdf,.xlsx,.csv,.txt,.md,.docx,.pptx';
const supported = new Set(TASK_ATTACHMENT_ACCEPT.split(','));
const images = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const extension = (name: string) => name.toLowerCase().slice(name.lastIndexOf('.'));
export const isTaskAttachment = (name: string) => name.includes('.') && supported.has(extension(name));
export const isTaskImage = (name: string) => name.includes('.') && images.has(extension(name));
export type TaskAttachment = { id: string; name: string; mimeType: string; size: number };
export type TaskAttachmentTarget = number | string | {sheet:string;row:number};

/** Number same-name originals within their task, without changing their stored filenames. */
export function taskAttachmentLabels(files: readonly {name:string}[] = []): string[] {
  const counts=new Map<string,number>();
  for(const {name} of files)counts.set(name,(counts.get(name)??0)+1);
  return files.map(({name},index)=>(counts.get(name)??0)>1?`${name}（${index+1}）`:name);
}

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';
const OFFICE_MIME: Record<OfficeKind, RegExp> = {
  docx: /wordprocessingml\.document/i,
  xlsx: /spreadsheetml\.sheet/i,
  pptx: /presentationml\.presentation/i,
};
export function officeKind(file: { name: string; mimeType: string }): OfficeKind | undefined {
  const ext = /\.(docx|xlsx|pptx)$/i.exec(file.name)?.[1]?.toLowerCase() as OfficeKind | undefined;
  return ext ?? (Object.keys(OFFICE_MIME) as OfficeKind[]).find(k => OFFICE_MIME[k].test(file.mimeType));
}

export const WORKBOOK_SELECTION_QUESTION = '请回复要核对的工作簿完整文件名，包括名称后显示的编号。';

export function taskWorkbookChoices(files: readonly TaskAttachment[] = []) {
  const labels = taskAttachmentLabels(files);
  return files.flatMap((file, index) => officeKind(file) === 'xlsx' ? [{ file, label: labels[index] }] : []);
}

export const PDF_SELECTION_QUESTION = '请回复要核对的 PDF 完整文件名，包括名称后显示的编号。';

export function isTaskPdf(file: { name: string; mimeType: string }) {
  return /^application\/pdf\b/i.test(file.mimeType) || /\.pdf$/i.test(file.name);
}

export function taskPdfChoices(files: readonly TaskAttachment[] = [], ids?: readonly string[]) {
  const labels = taskAttachmentLabels(files);
  const candidates = ids && new Set(ids);
  return files.flatMap((file, index) => isTaskPdf(file) && (!candidates || candidates.has(file.id))
    ? [{ file, label: labels[index] }] : []);
}

export function taskAttachmentChoicesForQuestion(
  question: { question: string; attachmentChoiceIds?: readonly string[] } | undefined,
  files: readonly TaskAttachment[] = [],
) {
  if (question?.question === WORKBOOK_SELECTION_QUESTION) return {
    prompt: '选择要读取的工作簿', choices: taskWorkbookChoices(files),
  };
  if (question?.attachmentChoiceIds?.length) return {
    prompt: question.question===PDF_SELECTION_QUESTION?'选择要读取的 PDF':question.question, choices: taskPdfChoices(files, question.attachmentChoiceIds),
  };
}

/** Small ranges fit the inline picker. Larger ranges keep the free-form page reply. */
export function taskVisualPdfPageChoices(question:{pdfVisualCandidates?:readonly PdfVisualCandidate[]}|undefined,
  files:readonly TaskAttachment[]=[],answer='',
){
  const ranges=question?.pdfVisualCandidates;
  if(!ranges?.length||ranges.some(range=>!Number.isSafeInteger(range.from)||!Number.isSafeInteger(range.to)
    ||range.from<1||range.to<range.from)||ranges.reduce((sum,range)=>sum+range.to-range.from+1,0)>12)return [];
  const choices=taskPdfChoices(files);
  if(ranges.some(range=>!choices.some(choice=>choice.file.id===range.fileId)))return [];
  const groups=choices.flatMap(({file,label})=>{
    const pages=[...new Set(ranges.filter(range=>range.fileId===file.id)
      .flatMap(range=>Array.from({length:range.to-range.from+1},(_,index)=>range.from+index)))].sort((a,b)=>a-b);
    return pages.length?[{fileId:file.id,label,pages}]:[];
  });
  if(answer&&answer.split('\n').some(line=>!groups.some(group=>group.pages.some(page=>line===group.label+' 第 '+page+' 页'))))return [];
  return groups;
}
