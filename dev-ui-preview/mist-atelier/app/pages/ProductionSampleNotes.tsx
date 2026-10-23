import React from 'react';
import { Banner, Button, Mono } from '../../../../components/mist';
import type { ProductionSampleEvidence } from '../../../../server/src/shared/mistProductionSamples';
import { uiText } from '../../../../services/interfaceLanguage';

export function ProductionSampleNotes({ checks }: { checks: ProductionSampleEvidence[] }) {
  const [expanded, setExpanded] = React.useState(false);
  const conditions = [...new Map(checks.filter(sample => sample.result === 'conditional').map(sample => [sample.sampleId, sample])).values()];
  if (!conditions.length) return null;
  return <Banner tone="warn" title={uiText('样品关注项')} actions={<Button size="sm" variant="quiet" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{uiText(expanded ? '收起' : '查看关注项')}</Button>}>
    {expanded ? conditions.map(sample => <p key={sample.sampleId}><Mono>{sample.sampleCode}</Mono> · {sample.opinion}</p>)
      : <span>{conditions.map(sample => sample.sampleCode).join(' · ')} · {uiText('有保留通过')}</span>}
  </Banner>;
}
