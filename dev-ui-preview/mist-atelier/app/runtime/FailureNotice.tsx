import React from 'react';
import { Banner, Button, useInModal } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import { usePageFailure, usePageFailureHosted } from './errorPresentation';

/**
 * A page-level operation or read failure. In the app shell it goes to the bottom-right status card so the page layout
 * does not shift; inside a dialog or drawer, or with no shell (tests, standalone), it stays in place as a notice.
 */
export function FailureNotice({ title, detail, retry, retryLabel = '重试' }: { title: React.ReactNode; detail?: React.ReactNode; retry?: () => void; retryLabel?: string }) {
  const inModal = useInModal(), hosted = usePageFailureHosted();
  const text = typeof detail === 'string' ? detail : typeof detail === 'number' ? String(detail) : '';
  const routed = hosted && !inModal && typeof title === 'string';
  usePageFailure(typeof title === 'string' ? title : '', routed ? text || title as string : '', retry);
  if (routed) return null;
  return <Banner variant="notice" tone="bad" title={title} actions={retry ? <Button size="sm" onClick={retry}>{uiText(retryLabel)}</Button> : undefined}>{detail}</Banner>;
}
