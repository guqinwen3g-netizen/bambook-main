/** Limits for a single personal Agent message. */
export const TASK_ATTACHMENT_COUNT = 6;
export const TASK_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const TASK_ATTACHMENT_TOTAL_BYTES = 24 * 1024 * 1024;
export const TASK_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.pdf,.xlsx,.csv,.txt,.md,.docx,.pptx';
const supported = new Set(TASK_ATTACHMENT_ACCEPT.split(','));
const images = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const extension = (name: string) => name.toLowerCase().slice(name.lastIndexOf('.'));
export const isTaskAttachment = (name: string) => name.includes('.') && supported.has(extension(name));
export const isTaskImage = (name: string) => name.includes('.') && images.has(extension(name));
export type TaskAttachment = { id: string; name: string; mimeType: string; size: number };
