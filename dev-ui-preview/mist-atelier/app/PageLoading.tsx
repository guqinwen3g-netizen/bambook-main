import React from 'react';
import { Card, CardBody, MistPage, Skeleton } from '../../../components/mist';
import { uiText } from '../../../services/interfaceLanguage';

export function PageLoading() {
  return <MistPage><Card role="status" aria-busy="true" aria-label={uiText('正在加载…')}><CardBody><Skeleton height={18} width="40%"/><Skeleton height={12}/><Skeleton height={12} width="70%"/></CardBody></Card></MistPage>;
}
