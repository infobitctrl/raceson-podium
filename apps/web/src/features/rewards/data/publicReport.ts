import { decodePublicRewardReport } from "@raceson/domain/rewards/public-report";
import { assertPublicEnvironmentOrigin, publicEnv } from "@/lib/public-env";

export async function readPublicRewardReport(signal: AbortSignal) {
  assertPublicEnvironmentOrigin();
  const demo = publicEnv.rewardDemo;
  if (!demo || demo.chainId !== 10143) throw new Error("public_report_demo_required");
  const response = await fetch(`${demo.apiBaseUrl}/v1/rewards/public-report`, {
    method: "GET", credentials: "omit", cache: "no-store", redirect: "error", signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("public_report_unavailable");
  const envelope: unknown = await response.json();
  if (!envelope || typeof envelope !== "object" || !("data" in envelope)) throw new Error("invalid_public_report_response");
  return decodePublicRewardReport(envelope.data);
}
