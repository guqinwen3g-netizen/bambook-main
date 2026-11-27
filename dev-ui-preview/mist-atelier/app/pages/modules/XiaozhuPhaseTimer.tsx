import React from 'react';
import { ui } from '../../../../../services/interfaceLanguage';

export function XiaozhuPhaseTimer({ at, countdown = false }: { at: string; countdown?: boolean }) {
  const [now, setNow] = React.useState(Date.now);
  const target = Date.parse(at);
  React.useEffect(() => {
    const current = Date.now();
    setNow(current);
    if (!Number.isFinite(target) || (countdown && current >= target)) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (countdown && current >= target) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [target, countdown]);
  if (!Number.isFinite(target)) return null;
  const seconds = countdown ? Math.ceil((target - now) / 1000) : Math.max(0, Math.floor((now - target) / 1000));
  if (countdown && seconds <= 0) return null;
  return <span className="mist-xz-elapsed" role="timer" aria-live="off">· {countdown ? ui`最早 ${seconds} 秒后重试` : ui`${seconds} 秒`}</span>;
}
