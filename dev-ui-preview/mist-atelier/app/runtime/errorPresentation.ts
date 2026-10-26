import {createContext,useEffect,useSyncExternalStore} from 'react';
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
