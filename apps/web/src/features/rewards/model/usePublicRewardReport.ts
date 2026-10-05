import { useEffect, useState } from "react";
import type { PublicRewardReport } from "@raceson/domain/rewards/public-report";
import { readPublicRewardReport } from "../data/publicReport";

export function usePublicRewardReport() {
  const [data,setData] = useState<PublicRewardReport | null>(null);
  const [failed,setFailed] = useState(false), [attempt,setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setFailed(false);
    void readPublicRewardReport(controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);
  return { data, failed, retry: () => setAttempt(n => n + 1) };
}
