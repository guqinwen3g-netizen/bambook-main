import type { EmailMessageFolder } from './mistEmail';

export type MailRemoteRef = { folder: string; uid: number; uidValidity: number; hash?: string };
export type MailStateField = 'read' | 'starred' | 'folder';
export type MailStateObservation = {
  id: string; expected: MailRemoteRef; remote?: MailRemoteRef;
  folder?: EmailMessageFolder; read?: boolean; starred?: boolean; missing?: boolean;
};
export type MailStateView = {
  messageId: string; state: 'pending' | 'running' | 'failed' | 'unknown' | 'blocked';
  fields: MailStateField[]; canRetry: boolean; error?: string;
};
