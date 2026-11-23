import React from 'react';
import { Card, CardBody, MistPage, Skeleton } from '../../../components/mist';
import { uiText } from '../../../services/interfaceLanguage';

export function PageLoading() {
  return <MistPage><Card role="status" aria-busy="true" aria-label={uiText('正在加载…')}><CardBody><Skeleton height={18} width="40%"/><Skeleton height={12}/><Skeleton height={12} width="70%"/></CardBody></Card></MistPage>;
}

/** An inline loading placeholder for content whose surrounding page is already visible. */
export function LoadingRows({ label, rows = 3 }: { label: string; rows?: 1 | 2 | 3 | 4 }) {
  return <div className="mist-col" style={{ width: '100%' }} role="status" aria-busy="true" aria-label={uiText(label)}>
    {['66%', '92%', '79%', '86%'].slice(0, rows).map(width => <Skeleton key={width} width={width} height={14} />)}
  </div>;
}

/** 页面代码下载失败（断网或发布后旧标签页）时给出重新加载，不让整个外壳白屏。 */
export class PageLoadBoundary extends React.Component<{ resetKey: string; fallback: (retry: () => void) => React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: { resetKey: string }) { if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }); }
  render() { return this.state.failed ? this.props.fallback(() => location.reload()) : this.props.children; }
}
