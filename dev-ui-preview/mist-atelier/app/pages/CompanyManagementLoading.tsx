import React from 'react';
import { Card, CardBody, MistPage, PageHeader, Skeleton } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';

export function CompanyManagementLoading() {
  return <MistPage>
    <PageHeader title={uiText('公司管理')} />
    <div className="mist-wizard" role="status" aria-busy="true" aria-label={uiText('正在加载…')}>
      <div className="mist-vsteps" aria-hidden="true">
        {[64, 92, 76, 80].map(width => <Skeleton key={width} width={width} height={38} />)}
      </div>
      <div className="mist-col" aria-hidden="true">
        <Card><CardBody><Skeleton width="38%" height={36} /></CardBody></Card>
        <Card><CardBody>
          {['86%', '74%', '92%', '80%'].map(width => <Skeleton key={width} width={width} height={36} />)}
        </CardBody></Card>
      </div>
    </div>
  </MistPage>;
}
