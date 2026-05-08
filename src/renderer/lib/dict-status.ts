import { useEffect, useState } from 'react';
import { api } from '@platform';
import type { DictStatus } from '@shared/ipc';

export function useDictStatus(): {
  status: DictStatus;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<DictStatus>({ kind: 'unknown' });

  async function refresh() {
    const res = await api.getDictStatus();
    if (res.ok) setStatus(res.data);
  }

  useEffect(() => {
    void refresh();
    const off = api.onDictProgress((s) => setStatus(s));
    return off;
  }, []);

  return { status, refresh };
}
