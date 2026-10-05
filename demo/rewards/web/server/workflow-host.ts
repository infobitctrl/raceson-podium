import {resolve} from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { createAdminSupabaseClient, loadServerEnv } from "@raceson/db";
import { rewardDemoTarget } from "@raceson/domain/rewards/environment";
import { canaryPublicClient } from "@raceson/rewards-chain/canary-public-client";
import { createReadOnlyWorkflowHostV3, createWorkflowBridgeV3, WorkflowScheduleStoreV3, type WorkflowHostV3, type WorkflowEndpointV3 } from "@raceson/api/rewards-demo";

const directory = resolve(process.cwd(), "../local/.artifacts/workflow-v3-10143");
let cached: WorkflowHostV3 | undefined;

/** Local testnet adapter. No import-time worker, custody lookup, shell,
 * environment pull or production fallback. Execution host provisioning is a
 * separate private bootstrap, not a browser request or an environment boolean. */
export function localWorkflowHostV3(path: string | undefined, authorization?: string): WorkflowEndpointV3 | undefined {
  if (!path?.startsWith("/api/v1/organizer/rewards/workflow-v3/")) return undefined;
  const assertTarget = () => {
    const values = process.env;
    const target = rewardDemoTarget({ mode: values.RACESON_REWARD_PORTAL_MODE,
      origin: values.RACESON_REWARD_DEMO_ORIGIN, supabaseUrl: values.RACESON_REWARD_DEMO_SUPABASE_URL });
    if (values.NODE_ENV !== "development" || target?.mode !== "local-testnet"
      || target.origin !== "http://127.0.0.1:3102" || target.supabaseUrl !== "http://127.0.0.1:55321") {
      throw Error("reward_workflow_not_configured");
    }
    const env = loadServerEnv();
    if (env.appBaseUrl !== target.origin || env.supabaseUrl !== target.supabaseUrl) throw Error("reward_workflow_not_configured");
    return { target, env };
  };
  const { target, env } = assertTarget();
  const socketPath = directory + "/host.sock";
  // The separately launched private worker must already exist. A request can
  // neither start it nor change its policy. Never cache a request's bearer.
  if (existsSync(socketPath)) {
    const token = /^Bearer ([^\s]+)$/i.exec(authorization ?? "")?.[1] ?? "";
    return createWorkflowBridgeV3({ target, socketPath, accessToken: token });
  }
  if (!cached) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const store = new WorkflowScheduleStoreV3(directory);
    // Explicit validated environment; the client cannot discover production.
    const client = createAdminSupabaseClient(env);
    cached = createReadOnlyWorkflowHostV3({ target, store, reader: canaryPublicClient,
      rpc: (method, args) => client.rpc(method, args), assertActive: () => { assertTarget(); } });
  }
  return cached;
}
