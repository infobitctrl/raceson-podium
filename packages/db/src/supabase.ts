import { createClient } from "@supabase/supabase-js";
import { loadServerEnv, type ServerEnv } from "./env.js";

type HeaderCarrier = Headers | Record<string, string | string[] | undefined>;

export function createAdminSupabaseClient(env: ServerEnv = loadServerEnv()) {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createServerAuthSupabaseClient(env: ServerEnv = loadServerEnv()) {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function createUserSupabaseClient(accessToken: string, env: ServerEnv = loadServerEnv()) {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export function readBearerToken(headers: HeaderCarrier) {
  const rawHeader =
    headers instanceof Headers
      ? headers.get("authorization")
      : headers.authorization ?? headers.Authorization;

  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!value) return null;

  const [scheme, token] = value.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}
