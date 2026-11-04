import {createContext,useEffect,useId,useRef,useSyncExternalStore} from 'react';
/** The enclosing app has already rendered this exact error; standalone surfaces keep their own feedback. Modal errors remain inside the active dialog because the enclosing page is behind its overlay. */
export const MistPresentedErrorContext=createContext<string|undefined>(undefined);

/** 某个页面区块已接管待核对的上传（核对后关联到原记录）时，外壳不再重复提示同一请求。 */
let claimedUpload: string | null = null;
const claimListeners = new Set<() => void>();
const announce = () => claimListeners.forEach(listener => listener());
export function useUploadRecoveryClaim(requestId: string | null) {
  useEffect(() => {
    if (!requestId) return;
    claimedUpload = requestId; announce();
    return () => { if (claimedUpload === requestId) { claimedUpload = null; announce(); } };
  }, [requestId]);
}
export const useClaimedUploadRecovery = () => useSyncExternalStore(listener => { claimListeners.add(listener); return () => { claimListeners.delete(listener); }; }, () => claimedUpload, () => null);

/** 页面自己展示并处理“上次操作待核对”（核对后还要做本页善后）时声明接管，外壳不再重复同一条提示。 */
let claimedPending = 0;
const pendingListeners = new Set<() => void>();
export function usePendingRecoveryClaim(active: boolean) {
  useEffect(() => {
    if (!active) return;
    claimedPending++; pendingListeners.forEach(listener => listener());
    return () => { claimedPending--; pendingListeners.forEach(listener => listener()); };
  }, [active]);
}
export const usePendingRecoveryClaimed = () => useSyncExternalStore(listener => { pendingListeners.add(listener); return () => { pendingListeners.delete(listener); }; }, () => claimedPending > 0, () => false);

/**
 * 页面级操作失败送到外壳右下角的状态卡，而不是插进页面顶部。弹窗内的失败仍留在弹窗里。
 * 页面关闭、换对象或错误清空时自动撤下。
 */
export type PageFailure = { id: string; title: string; detail: string; retry?: () => void };
let pageFailures: PageFailure[] = [];
const failureListeners = new Set<() => void>();
const announceFailures = () => failureListeners.forEach(listener => listener());
export function usePageFailure(title: string, detail: string | null | undefined, retry?: () => void) {
  const id = useId(), retryRef = useRef(retry); retryRef.current = retry;
  useEffect(() => {
    if (!detail) return;
    pageFailures = [...pageFailures.filter(item => item.id !== id), { id, title, detail, retry: retryRef.current ? () => retryRef.current?.() : undefined }]; announceFailures();
    return () => { pageFailures = pageFailures.filter(item => item.id !== id); announceFailures(); };
  }, [id, title, detail, !!retry]); // eslint-disable-line react-hooks/exhaustive-deps
}
export const usePageFailures = () => useSyncExternalStore(listener => { failureListeners.add(listener); return () => { failureListeners.delete(listener); }; }, () => pageFailures, () => pageFailures);
/** Set by the app shell while it renders the bottom-right card; without it (tests, standalone pages) failures stay in place. */
let shellHosts = 0;
const hostListeners = new Set<() => void>();
export function usePageFailureHost() {
  useEffect(() => { shellHosts++; hostListeners.forEach(listener => listener()); return () => { shellHosts--; hostListeners.forEach(listener => listener()); }; }, []);
}
export const usePageFailureHosted = () => useSyncExternalStore(listener => { hostListeners.add(listener); return () => { hostListeners.delete(listener); }; }, () => shellHosts > 0, () => false);
