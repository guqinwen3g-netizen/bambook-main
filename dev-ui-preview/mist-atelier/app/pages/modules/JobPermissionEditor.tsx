import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** 岗位权限编辑：按业务模块选「不可用 / 查看 / 办理 / 审批」，专项权限在模块下逐项勾选。 */
import React from 'react';
import { CardHeader, Checkbox, Pill, Segmented, TextLink } from '../../../../../components/mist';
import { permissionLabel } from '../../runtime/permissionLabels';
import { JOB_AREAS, levelsOf, moduleGate, moduleLevel, setModuleLevel, type JobLevel, type JobModule } from '../../runtime/jobPermissions';

const LEVEL_LABEL: Record<JobLevel | 'partial', string> = { none: '不可用', read: '查看', write: '办理', approve: '审批', partial: '自定义' };

/** 岗位持有的各档数量，用于列表概要。 */
export function jobSummary(granted: readonly string[]) {
  const counts = { read: 0, write: 0, approve: 0, partial: 0 };
  for (const area of JOB_AREAS) for (const module of area.modules) { const level = moduleLevel(module, granted); if (level !== 'none') counts[level] += 1; }
  return [counts.approve && `审批 ${counts.approve}`, counts.write && `办理 ${counts.write}`, counts.read && `查看 ${counts.read}`, counts.partial && `自定义 ${counts.partial}`].filter(Boolean).join(' · ');
}

function ModuleRow({ module, value, onChange, available, readOnly }: { module: JobModule; value: string[]; onChange: (next: string[]) => void; available: Set<string>; readOnly: boolean }) {
  const level = moduleLevel(module, value), extras = module.extra.filter(scope => available.has(scope) || value.includes(scope));
  const held = extras.filter(scope => value.includes(scope)).length;
  const [open, setOpen] = React.useState(held > 0 && !module.read.length);
  const gate = moduleGate(module, value);
  const levels = levelsOf(module);
  return <div className="mist-col" style={{ gap: 6 }}>
    <div className="mist-row" data-wrap>
      <span style={{ flex: 1, minWidth: 140 }}>{uiText(module.label)}</span>
      {levels.length > 1 && (readOnly
        ? <Pill tone={level === 'none' ? 'neutral' : level === 'partial' ? 'warn' : 'ok'} plain>{uiText(LEVEL_LABEL[level])}</Pill>
        : <>{level === 'partial' && <Pill tone="warn" plain>{uiText('自定义')}</Pill>}
          <Segmented<JobLevel> ariaLabel={ui`${module.label}权限`} value={level as JobLevel} onChange={next => onChange(setModuleLevel(module, value, next).filter(scope => available.has(scope) || value.includes(scope)))}
            options={levels.map(item => ({ value: item, label: LEVEL_LABEL[item] }))} /></>)}
      <span style={{ width: 76, display: 'inline-flex', justifyContent: 'flex-end' }}>{extras.length > 0 && <TextLink onClick={() => setOpen(!open)}>{uiText(`专项 ${held}/${extras.length}`)}</TextLink>}</span>
    </div>
    {gate && <span className="mist-note">{uiText(`办理需任职部门含「${gate}」`)}</span>}
    {open && extras.length > 0 && <div className="mist-col" style={{ gap: 4, paddingLeft: 12 }}>
      {extras.map(scope => <Checkbox key={scope} label={uiText(permissionLabel(scope))} checked={value.includes(scope)} disabled={readOnly}
        onChange={on => onChange(on ? [...value, scope] : value.filter(item => item !== scope))} />)}
    </div>}
  </div>;
}

export function JobPermissionEditor({ value, onChange, catalog, readOnly = false }: { value: string[]; onChange: (next: string[]) => void; catalog: readonly string[]; readOnly?: boolean }) {
  const available = React.useMemo(() => new Set(catalog), [catalog]);
  return <>{JOB_AREAS.map(area => <div key={area.label} className="mist-section">
    <CardHeader title={uiText(area.label)} />
    <div className="mist-col">{area.modules.map(module => <ModuleRow key={module.key} module={module} value={value} onChange={onChange} available={available} readOnly={readOnly} />)}</div>
  </div>)}</>;
}
