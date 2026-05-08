import { useEffect, useState } from 'react';
import { api } from '@platform';
import type { UpdateStatus } from '@shared/ipc';

export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    void api.getUpdateStatus().then((res) => {
      if (!cancelled && res.ok) setStatus(res.data);
    });
    const off = api.onUpdateStatus((s) => setStatus(s));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return status;
}
