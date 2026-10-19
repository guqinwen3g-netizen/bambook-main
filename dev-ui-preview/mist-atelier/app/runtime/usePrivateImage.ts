import React from 'react';
import { apiService } from '../../../../services/apiService';
import { useMistSession } from './auth';

/** Private attachments must be fetched with the current login, never exposed as bearer URLs. */
export function usePrivateImage(path: string | undefined): string | undefined {
  const session = useMistSession();
  const key = `${session.sessionKey}:${session.user?.id || ''}:${path || ''}`;
  const [image, setImage] = React.useState<{ key: string; url: string }>();
  React.useEffect(() => {
    if (!path) return;
    let active = true, url = '';
    const controller = new AbortController();
    void fetch(path, { headers: apiService.getAuthHeaders(), credentials: 'include', signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('图片读取失败'); return response.blob(); })
      .then(blob => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setImage({ key, url });
      }).catch(() => { if (active) setImage(undefined); });
    return () => { active = false; controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [key, path]);
  return image?.key === key ? image.url : undefined;
}
