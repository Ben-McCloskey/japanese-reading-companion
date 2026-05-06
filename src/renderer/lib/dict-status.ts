import { useEffect, useState } from 'react';
import type { DictStatus } from '@shared/ipc';

export function useDictStatus(): {
  status: DictStatus;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<DictStatus>({ kind: 'unknown' });

  async function refresh() {
    const res = await window.api.getDictStatus();
    if (res.ok) setStatus(res.data);
  }

  useEffect(() => {
    void refresh();
    const off = window.api.onDictProgress((s) => setStatus(s));
    return off;
  }, []);

  return { status, refresh };
}
