/** Platform market reference quotes (Bank of China settlement rates, domestic spot materials). Reference values only. */
import React from 'react';
import { apiService } from '../../../../services/apiService';
import type { MarketSnapshot } from '../../../../server/src/ai/marketQuotes';

let cache: { at: number; value: MarketSnapshot | null } | null = null;
export function useMarketQuotes(): MarketSnapshot | null {
  const [value, setValue] = React.useState<MarketSnapshot | null>(cache?.value ?? null);
  React.useEffect(() => {
    if (cache && Date.now() - cache.at < 5 * 60 * 1000) return;
    let live = true;
    fetch('/api/mist/market/quotes', { headers: apiService.getAuthHeaders(), credentials: 'include' })
      .then(r => r.ok ? r.json() : null).then(body => { cache = { at: Date.now(), value: body?.latest ?? null }; if (live) setValue(cache.value); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return value;
}
