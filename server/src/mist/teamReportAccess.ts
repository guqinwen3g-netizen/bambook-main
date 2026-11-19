import type { TokenPayload } from '../auth/service';
import { hasScope } from '../auth/permissionService';
import type { MistState } from '../shared/mistWorkspace';
import type { MistDataScope } from '../shared/mistDataScope';
import { TEAM_REPORT_READ_GATES, teamShipmentLineSourceId, type TeamReportReadProof, type TeamReportSource, type TeamReportSourceKind, type TeamWeeklyArchive, type TeamWeeklyArchiveView } from '../shared/mistTeam';

const kinds: TeamReportSourceKind[] = ['orders','orderLines','shipments','shipmentLines','invoices','receipts','customers','devs','followUps','opportunities','tasks'];
const allowedPermissions = new Set<string>(TEAM_REPORT_READ_GATES.flatMap(group => [...group]));
/** Capture only effective input-read grants; unrelated write/admin grants never gate an old report. */
export function teamReportReadPermissions(actor: TokenPayload): string[] {
  return [...new Set(TEAM_REPORT_READ_GATES.filter(group => group.every(scope => hasScope(actor, scope as any))).flatMap(group => [...group]))].sort();
}
function sourceSets(state: MistState): Map<TeamReportSourceKind, Set<string>> {
  const sets = new Map<TeamReportSourceKind, Set<string>>();
  const add = (kind: TeamReportSourceKind, rows: Array<{id:string}> | undefined) => sets.set(kind,new Set((rows || []).map(row => row.id)));
  add('orders',state.orders); add('orderLines',state.orderLines); add('invoices',state.invoices); add('receipts',state.receipts);
  add('customers',state.customers); add('devs',state.devs); add('tasks',state.tasks);
  add('shipments',state.fulfillment?.shipments); add('followUps',state.crm?.followUps); add('opportunities',state.crm?.opportunities);
  sets.set('shipmentLines',new Set((state.fulfillment?.shipments || []).flatMap(shipment => shipment.lines.map(line => teamShipmentLineSourceId(shipment.id,line)))));
  return sets;
}
function proofOf(archive: TeamWeeklyArchive, actor: TokenPayload, workspaceId?: string): TeamReportReadProof | null {
  const p = archive.readProof;
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(key => !['version','workspaceId','companyId','generatedById','weekStart','permissions','sources'].includes(key))) return null;
  if (p.version !== 1 || !workspaceId || p.workspaceId !== workspaceId || p.companyId !== (actor.companyId ?? null) || p.generatedById !== archive.generatedById || p.weekStart !== archive.weekStart) return null;
  if (!Array.isArray(p.permissions) || !p.permissions.every(scope => typeof scope === 'string' && allowedPermissions.has(scope)) || new Set(p.permissions).size !== p.permissions.length) return null;
  if (!Array.isArray(p.sources) || !p.sources.every(source => source && typeof source === 'object' && !Array.isArray(source) && Object.keys(source).every(key => key === 'kind' || key === 'id') && kinds.includes(source.kind) && typeof source.id === 'string' && source.id.length > 0)) return null;
  return p;
}
function unavailable(archive: TeamWeeklyArchive): TeamWeeklyArchiveView {
  // Keep a caller's own archive identity so it cannot look absent and invite duplicate generation.
  return { id:archive.id,weekStart:archive.weekStart,weekEnd:archive.weekEnd,generatedAt:archive.generatedAt,generatedById:archive.generatedById,generatedBy:archive.generatedBy,scope:'',unavailable:true };
}
/** Stored aggregates cannot be re-clipped or recalculated: authorize their original inputs instead. */
export function projectTeamReports(raw: MistState, visible: MistState, actor: TokenPayload, scope?: MistDataScope, workspaceId?: string): TeamWeeklyArchiveView[] {
  if (!hasScope(actor,'relations:admin')) return [];
  const archives = (raw as MistState & {teamReports?:TeamWeeklyArchive[]}).teamReports || [];
  const current = sourceSets(visible), all = sourceSets(raw);
  const fullFields = TEAM_REPORT_READ_GATES.every(group => group.every(permission => hasScope(actor,permission as any)));
  const fullCurrentInputs = !scope && fullFields && kinds.every(kind => [...all.get(kind)!].every(id => current.get(kind)!.has(id)));
  const result: TeamWeeklyArchiveView[] = [];
  for (const archive of archives) {
    const own = archive.generatedById === actor.userId, proof = proofOf(archive,actor,workspaceId);
    let readable = false;
    if (proof) {
      const fields = proof.permissions.every(permission => hasScope(actor,permission as any));
      const covered = proof.sources.every(source => current.get(source.kind)!.has(source.id)
        // A full-company creator keeps their own legitimate history if a source was actually deleted,
        // never if it still exists but is currently hidden (private source or a reduced field grant).
        || own && !scope && fullFields && !all.get(source.kind)!.has(source.id));
      readable = fields && covered && (own || proof.sources.length > 0 || fullCurrentInputs);
    } else if (archive.readProof === undefined) {
      // No historical source/permission facts are invented or backfilled. Only a currently complete
      // company input view can establish a safe upper bound for an old unbound aggregate.
      readable = fullCurrentInputs;
    }
    if (readable) { const {readProof:_proof,...view}=structuredClone(archive); result.push(view); }
    else if (own) result.push(unavailable(archive));
  }
  return result;
}
