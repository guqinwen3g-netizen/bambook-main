import type { TokenPayload } from '../auth/service';
import { hasScope } from '../auth/permissionService';
import type { PermissionScope } from '../_shared/rolePermissionMatrix';
import { sealImageAllowed } from '../shared/mistSeals';
import type { MistState } from '../shared/mistWorkspace';
import { COMPANY_MAINTAIN_SCOPE } from './companyLibrary';
import type { MistPrivateFiles } from './files';

export type FilePrivacyContext = {
  digests: ReadonlyMap<string, string>;
  /** Failed verification is not evidence that a same-size file is unrelated. */
  unavailable: ReadonlySet<string>;
  current?: MistState;
};
const storedDigest = (file: { sha256?: string } | undefined) => file?.sha256 && /^[a-f0-9]{64}$/.test(file.sha256) ? file.sha256 : undefined;

export function taxOriginalFileIds(state: MistState): Set<string> {
  return new Set([
    ...(state.payables?.bills || []).filter(bill => bill.invoiceType === 'vat-special' || bill.taxAmount > 0).flatMap(bill => bill.fileIds || []),
    ...(state.exportRebate?.claims || []).flatMap(claim => claim.fileIds || []),
  ]);
}
export function sensitiveOriginalFileIds(state: MistState): Set<string> {
  return new Set([...taxOriginalFileIds(state), ...(state.seals || []).flatMap(seal => seal.fileId ? [seal.fileId] : [])]);
}
export function fileMaintainer(actor: TokenPayload, ownerId?: string): boolean {
  return hasScope(actor, COMPANY_MAINTAIN_SCOPE as PermissionScope) || !!ownerId && ownerId === actor.userId;
}
function deniedOriginals(state: MistState, actor: TokenPayload, ownerId: string | undefined, review: boolean): Set<string> {
  const denied = hasScope(actor, 'sensitive:tax_base') ? new Set<string>() : taxOriginalFileIds(state);
  const maintainer = fileMaintainer(actor, ownerId), agent = (actor as { actorKind?: string }).actorKind === 'agent';
  for (const seal of state.seals || []) if (seal.fileId && (review || !sealImageAllowed(seal, actor.userId, maintainer, agent))) denied.add(seal.fileId);
  return denied;
}

/** Content identity propagates an existing sensitivity rule, not ordinary business visibility. */
function contentRules(state: MistState, actor: TokenPayload, ownerId?: string, context?: FilePrivacyContext, review = false) {
  const current = context?.current || state;
  const denied = new Set([...deniedOriginals(state, actor, ownerId, review), ...deniedOriginals(current, actor, ownerId, review)]);
  const metadata = new Map([...(state.files || []), ...(current.files || [])].map(file => [file.id, file]));
  const hashes = new Set<string>(), sizes = new Set<number>();
  let missingOriginMetadata = false;
  for (const id of denied) {
    const file = metadata.get(id), hash = context?.digests.get(id) || storedDigest(file);
    if (hash) hashes.add(hash);
    else if (file && file.size > 0) sizes.add(file.size);
    else if (file) continue; // A virtual, zero-byte demo reference has no uploaded content to duplicate.
    else missingOriginMetadata = true;
  }
  const knownSizes = new Set([...denied].flatMap(id => (metadata.get(id)?.size || 0) > 0 ? [metadata.get(id)!.size] : []));
  const restricted = (hash: string | undefined, size: number) => denied.size > 0 && (missingOriginMetadata || sizes.has(size) || (hash ? hashes.has(hash) : knownSizes.has(size)));
  return { denied, restricted };
}
export function restrictedSensitiveFiles(state: MistState, actor: TokenPayload, ownerId?: string, context?: FilePrivacyContext, review = false): Set<string> {
  const { denied, restricted } = contentRules(state, actor, ownerId, context, review);
  for (const file of state.files || []) if (restricted(context?.digests.get(file.id) || storedDigest(file), file.size)) denied.add(file.id);
  return denied;
}
export function restrictedUploadContent(state: MistState, actor: TokenPayload, ownerId: string | undefined, context: FilePrivacyContext, digest: string, size: number): boolean {
  return contentRules(state, actor, ownerId, context).restricted(digest, size);
}

/** Read-only and request-scoped: never rewrites a workspace or trusts a client digest. */
export async function prepareFilePrivacy(files: MistPrivateFiles, workspaceId: string, state: MistState): Promise<FilePrivacyContext> {
  const origins = sensitiveOriginalFileIds(state);
  if (!origins.size) return { digests: new Map(), unavailable: new Set() };
  const metadata = new Map((state.files || []).map(file => [file.id, file]));
  const sizes = new Set([...origins].flatMap(id => metadata.has(id) ? [metadata.get(id)!.size] : []));
  const digests = new Map<string, string>(), unavailable = new Set<string>();
  // Sequential reads bound memory; the immutable file cache deduplicates concurrent requests.
  for (const file of state.files || []) if (file.size > 0 && (origins.has(file.id) || sizes.has(file.size))) {
    try { digests.set(file.id, await files.digest(workspaceId, file)); }
    catch { unavailable.add(file.id); }
  }
  return { digests, unavailable };
}
