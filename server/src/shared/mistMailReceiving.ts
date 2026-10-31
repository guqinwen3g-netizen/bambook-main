export type MailReceivingView = {
  accountId: string; version: number; enabled: boolean;
  state: 'off' | 'waiting' | 'running' | 'retrying' | 'blocked';
  canEnable: boolean; canDisable: boolean;
  lastAttemptAt: string | null; lastSuccessAt: string | null; nextRunAt: string | null;
  pending: number; error: { code: string; message: string } | null;
  lastChangeId?: string;
};
export type MailReceivingPage = { serviceAvailable: boolean; items: MailReceivingView[] };
