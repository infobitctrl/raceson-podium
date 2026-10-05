import {decodeProtectedHeader, importSPKI, jwtVerify} from "jose";
import {z} from "zod";

const policy = z.object({
  appId: z.string().regex(/^[a-z0-9]{20,64}$/),
  verificationKey: z.string().min(100).max(2048).optional(),
  verificationKeys: z.array(z.object({kid:z.string().min(1).max(200),key:z.string().min(100).max(2048)}).strict()).min(1).max(4).optional(),
  subject: z.string().regex(/^did:privy:[a-zA-Z0-9_-]{1,100}$/),
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(v => BigInt(v) !== 0n).transform(v => v.toLowerCase()),
}).strict().refine(v=>Boolean(v.verificationKey)!==Boolean(v.verificationKeys),"Exactly one verification key configuration is required")
  .refine(v=>!v.verificationKeys||new Set(v.verificationKeys.map(k=>k.kid)).size===v.verificationKeys.length,"Duplicate verification key IDs");
export type ControllerPolicy = z.infer<typeof policy>;
export function controllerPolicyFromEnv(env: Record<string,string|undefined>): ControllerPolicy | null {
  if (!env.RACESON_REWARD_CONTROLLER) return null;
  const parsed = policy.parse(JSON.parse(env.RACESON_REWARD_CONTROLLER));
  if (parsed.appId !== env.RACESON_REWARD_PRIVY_APP_ID) throw Error("controller_not_configured");
  return parsed;
}

/** Controller identity is a Privy DID, never a platform UUID or browser wallet claim.
 * Authorization is the owner-configured DID + fixed operator address. Signing
 * separately proves possession of that address to the contract. */
export async function authenticateController(token: string, config: ControllerPolicy) {
  if (!token || token.length > 8192) throw Error("controller_auth_required");
  try {
    const pem=config.verificationKey??config.verificationKeys?.find(k=>k.kid===decodeProtectedHeader(token).kid)?.key;
    if(!pem)throw Error("unknown_key");
    const key = await importSPKI(pem, "ES256");
    const {payload} = await jwtVerify(token, key, {algorithms:["ES256"], issuer:"privy.io", audience:config.appId,
      requiredClaims:["sub","sid","iat","exp"], maxTokenAge:"1h", clockTolerance:5});
    if (payload.sub !== config.subject || typeof payload.sid !== "string" || !payload.sid.length) throw Error("denied");
    return {subject:payload.sub, sessionId:payload.sid, wallet:config.wallet};
  } catch { throw Error("controller_auth_required"); }
}
