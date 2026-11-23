type PrefetchConnection = Partial<EventTarget> & { saveData?: boolean; effectiveType?: string };

export function getPrefetchConnection(): PrefetchConnection | undefined {
  return (navigator as Navigator & { connection?: PrefetchConnection }).connection;
}

export function prefetchConnectionIsLimited(connection: PrefetchConnection | undefined): boolean {
  const type = connection?.effectiveType;
  return !!connection?.saveData || type === '3g' || /(^|-)2g$/.test(type ?? '');
}
