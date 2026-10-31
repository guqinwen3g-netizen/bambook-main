import { createHash } from 'node:crypto';
import type { EmailMessage, EmailMessageFolder } from '../../shared/mistEmail';
import type { MailStateObservation } from '../../shared/mistMailState';
import type { MailFolderInfo, MailImapSession } from './transport';
import type { MailStateAttempt } from './stateQueue';

export type StateFolder = { remote: string; folder: EmailMessageFolder };
const error = (code: string, message: string) => Object.assign(new Error(message), { code });
export function stateFolders(folders: MailFolderInfo[]): StateFolder[] {
  const find = (flag: string, names: string[]) => folders.find(f => f.attribs.some(a => a.toLowerCase() === flag.toLowerCase())) || folders.find(f => names.includes(f.path.split(/[/.]/).pop()!.toLowerCase()));
  const mapping: Array<[EmailMessageFolder, MailFolderInfo | undefined]> = [
    ['inbox', folders.find(f => f.path.toUpperCase() === 'INBOX')],
    ['sent', find('\\Sent', ['sent', 'sent messages', 'sent items', '已发送'])],
    ['archive', find('\\Archive', ['archive', 'archives', '归档', '已归档'])],
    ['trash', find('\\Trash', ['trash', 'deleted messages', 'deleted items', '已删除', '垃圾箱'])],
  ];
  return mapping.filter(([, f]) => f).map(([folder, f]) => ({ remote: f!.path, folder }));
}
export const rawMailHash = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
/** Locate only a unique, byte-identical copy. Message-ID alone is never proof of a move. */
export async function locateMail(session: MailImapSession, attempt: MailStateAttempt, folders: StateFolder[], check: () => Promise<void>) {
  if (!attempt.hash) return [];
  const found: Array<{ remote: {folder: string;uid:number;uidValidity:number;hash:string}; folder: EmailMessageFolder; read:boolean;starred:boolean }> = [];
  for (const folder of folders) {
    await check(); const box = await session.open(folder.remote);
    const ids = attempt.messageId && session.searchMessageId ? await session.searchMessageId(attempt.messageId)
      : attempt.target?.path === folder.remote && attempt.target.uidValidity === box.uidValidity ? await session.uidsAfter(attempt.target.uidNext - 1) : [];
    if (ids.length > 10) throw error('MAIL_STATE_AMBIGUOUS', '原邮箱中有多份候选邮件，请人工核对');
    if (!ids.length) continue;
    const raws = await session.fetch(ids);
    if (raws.length !== ids.length) throw error('MAIL_STATE_AMBIGUOUS', '邮件位置暂时无法确认，请稍后核对');
    for (const row of raws) if (rawMailHash(row.raw) === attempt.hash) found.push({ remote: { folder:folder.remote,uid:row.uid,uidValidity:box.uidValidity,hash:attempt.hash }, folder:folder.folder,read:row.seen,starred:!!row.starred });
  }
  return found;
}
/** Refresh a bounded rotating set of existing UIDs without downloading unchanged message bodies. */
export async function observeMailState(session: MailImapSession, messages: EmailMessage[], folders: StateFolder[], cursor: number, check: () => Promise<void>) {
  if (!session.metadata || !messages.length) return { observations: [] as MailStateObservation[], cursor:0 };
  const sorted = [...messages].filter(m => m.remote).sort((a,b) => a.id.localeCompare(b.id));
  const from = sorted.length ? cursor % sorted.length : 0, selected = [...sorted.slice(from),...sorted.slice(0,from)].slice(0,1000);
  const observations: MailStateObservation[] = []; let missingChecks = 0;
  const groups = new Map<string, EmailMessage[]>();
  for (const m of selected) groups.set(m.remote!.folder,[...(groups.get(m.remote!.folder)||[]),m]);
  for (const [path, group] of groups) {
    await check(); const box = await session.open(path), current = group.filter(m => m.remote!.uidValidity === box.uidValidity);
    const metadata = await session.metadata(current.map(m => m.remote!.uid)), rows = new Map(metadata.map(r => [r.uid,r]));
    for (const m of group) {
      const r = rows.get(m.remote!.uid);
      if (m.remote!.uidValidity === box.uidValidity && r) {
        observations.push({id:m.id,expected:m.remote!,remote:m.remote!,folder:m.remoteState?.folder || folders.find(f=>f.remote===path)?.folder || m.folder,read:r.seen,starred:r.starred});
      } else if (m.remote!.hash && missingChecks++ < 10) {
        const matches = await locateMail(session,{id:'observation',origin:m.remote!,messageId:m.messageId||'',hash:m.remote!.hash,issued:false},folders,check);
        if(matches.length===1) observations.push({id:m.id,expected:m.remote!,...matches[0]});
        else observations.push({id:m.id,expected:m.remote!,missing:true});
      } else observations.push({id:m.id,expected:m.remote!,missing:true});
    }
  }
  return {observations,cursor:sorted.length ? (from+selected.length)%sorted.length : 0};
}
export function observationChanged(m:EmailMessage,o:MailStateObservation) {
  if(o.missing)return !m.remoteMissing;
  const old=m.remoteState;
  return !!m.remoteMissing || !old || old.read!==o.read || old.starred!==o.starred || old.folder!==o.folder
    || JSON.stringify(m.remote)!==JSON.stringify(o.remote);
}
