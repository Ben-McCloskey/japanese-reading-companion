import { useEffect, useState } from 'react';
import { api } from '@platform';
import type { TokenizerStatus } from '@shared/ipc';

export function useTokenizerStatus(): TokenizerStatus {
  const [status, setStatus] = useState<TokenizerStatus>({ kind: 'warming' });

  useEffect(() => {
    let cancelled = false;
    void api.getTokenizerStatus().then((res) => {
      if (!cancelled && res.ok) setStatus(res.data);
    });
    const off = api.onTokenizerReady((s) => setStatus(s));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return status;
}
