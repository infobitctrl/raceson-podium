import { publicRewardReport } from "../../server/public-report";
import type { NextApiRequest, NextApiResponse } from "next";
import { handleRewardDemoApiRequest } from "@raceson/api/rewards-demo";
import { localPilotRunner } from "../../server/local-pilot";
import { localWorkflowHostV3 } from "../../server/workflow-host";

export const config = { api: { bodyParser: false, responseLimit: false } };

export default async function demoApi(request: NextApiRequest, response: NextApiResponse) {
  let workflow;
  try { workflow = localWorkflowHostV3(request.url, request.headers.authorization); }
  catch { /* The API returns its sanitized not-configured response. */ }
  await handleRewardDemoApiRequest(request, response, localPilotRunner(), workflow, publicRewardReport);
}
