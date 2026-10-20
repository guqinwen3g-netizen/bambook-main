import { useOptionalMistSession } from './auth';

/**
 * 当前账号的称呼：公司设置里的“我的显示名”只代表公司所有者本人；
 * 成员一律用自己账号的姓名（共用公司里不能把别人显示成自己）。
 */
export function useMyDisplayName(workspace: { ownerId?: string } | null | undefined, state: { settings?: { profileName?: string } } | null | undefined): string {
  const session = useOptionalMistSession(), me = session?.user?.id;
  const own = !session || (!!workspace && !!me && workspace.ownerId === me);
  return (own ? state?.settings?.profileName?.trim() : '') || session?.user?.displayName || '';
}
