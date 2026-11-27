/** Limits for a single personal Agent message. */
export const TASK_ATTACHMENT_COUNT = 6;
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
