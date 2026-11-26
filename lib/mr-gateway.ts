import "server-only";
import { z } from "zod";

const env = z.object({
  LITELLM_BASE_URL: z.string().url().optional(),
  LITELLM_MASTER_KEY: z.string().min(1).optional(),
}).parse(process.env);

const base = env.LITELLM_BASE_URL ?? "http://127.0.0.1:4000";
const readinessSchema = z.object({ status: z.string().optional(), db: z.string().optional() }).passthrough();
const modelsSchema = z.object({ data: z.array(z.object({ id: z.string() }).passthrough()).default([]) }).passthrough();
const activityMetricSchema = z.object({
  prompt_tokens: z.number().default(0),
  completion_tokens: z.number().default(0),
  total_tokens: z.number().default(0),
  successful_requests: z.number().default(0),
  failed_requests: z.number().default(0),
  api_requests: z.number().default(0),
  total_response_time_ms: z.number().default(0),
  timed_requests: z.number().default(0),
}).passthrough();
const dailyActivitySchema = z.object({
  results: z.array(z.object({ date: z.string(), metrics: activityMetricSchema }).passthrough()).default([]),
}).passthrough();

export class GatewayError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

async function request(path: string, init: RequestInit = {}) {
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin) throw new GatewayError(400, "Alamat gateway tidak valid.");
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (env.LITELLM_MASTER_KEY) headers.set("Authorization", `Bearer ${env.LITELLM_MASTER_KEY}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new GatewayError(response.status, response.status >= 500 ? "Gateway sedang mengalami gangguan." : `Permintaan ditolak (${response.status}).`);
  return response.json() as Promise<unknown>;
}

export async function getHealth() {
  try {
    const healthRaw = await request("/health/readiness");
    const health = readinessSchema.parse(healthRaw);
    let models: string[] = [];
    let modelsAvailable = false;
    if (env.LITELLM_MASTER_KEY) {
      try {
        const modelsRaw = await request("/v1/models");
        models = modelsSchema.parse(modelsRaw).data.map((model) => model.id);
        modelsAvailable = true;
      } catch {
        // Readiness tetap valid walaupun kredensial model ditolak atau schema berbeda.
      }
    }
    return {
      connected: true,
      database: health.db === "connected" ? "Terhubung" : "Tidak diketahui",
      models,
      modelsAvailable,
      mode: "live" as const,
      managementReady: Boolean(env.LITELLM_MASTER_KEY),
    };
  } catch {
    return { connected: false, database: "Tidak tersedia", models: [], modelsAvailable: false, mode: "disconnected" as const, managementReady: Boolean(env.LITELLM_MASTER_KEY) };
  }
}

export async function getKeys() {
  const raw = await request("/key/list?page=1&size=100&return_full_object=true");
  const parsed = z.object({ keys: z.array(z.unknown()).default([]), total_count: z.number().optional() }).passthrough().parse(raw);
  const allowed = new Set(["token_id", "key_alias", "user_id", "models", "rpm_limit", "tpm_limit", "expires", "blocked", "created_at", "spend"]);
  return { ...parsed, keys: parsed.keys.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item)).map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => allowed.has(key)))) };
}

export async function getUsers() {
  const raw = await request("/user/list?page=1&page_size=100");
  const parsed = z.object({ users: z.array(z.unknown()).default([]), total: z.number().optional() }).passthrough().parse(raw);
  const allowed = new Set(["user_id", "user_email", "user_role", "created_at", "spend", "models"]);
  return { ...parsed, users: parsed.users.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item)).map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => allowed.has(key)))) };
}

export async function getLogs(startDate?: string, endDate?: string) {
  const params = new URLSearchParams({ page: "1", page_size: "50" });
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  return request(`/spend/logs/v2?${params}`);
}

function jakartaDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function getDailyActivity(days = 7) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
  const params = new URLSearchParams({
    start_date: jakartaDate(start),
    end_date: jakartaDate(end),
    page: "1",
    page_size: "100",
    timezone: "-420",
    include_current_utc_day: "true",
  });
  return dailyActivitySchema.parse(await request(`/user/daily/activity?${params}`)).results;
}

export async function createVirtualKey(input: { user_id: string; key_alias: string; models: string[]; duration?: string; rpm_limit?: number; tpm_limit?: number; max_parallel_requests?: number; max_budget?: number }) {
  if (!env.LITELLM_MASTER_KEY) throw new GatewayError(503, "Kredensial pengelola LiteLLM belum dikonfigurasi.");
  const body = z.object({ user_id: z.string().min(1), key_alias: z.string().min(1).max(64), models: z.array(z.string()).min(1), duration: z.string().optional(), rpm_limit: z.number().int().positive().optional(), tpm_limit: z.number().int().positive().optional(), max_parallel_requests: z.number().int().positive().optional(), max_budget: z.number().positive().optional() }).parse(input);
  return z.object({ key: z.string() }).passthrough().parse(await request("/key/generate", { method: "POST", body: JSON.stringify(body) }));
}

export async function changeKey(action: "block" | "unblock" | "delete", key: string) {
  if (!env.LITELLM_MASTER_KEY) throw new GatewayError(503, "Kredensial pengelola LiteLLM belum dikonfigurasi.");
  const safeKey = z.string().min(1).max(200).parse(key);
  const body = action === "delete" ? { keys: [safeKey] } : { key: safeKey };
  await request(`/key/${action}`, { method: "POST", body: JSON.stringify(body) });
  return { ok: true };
}

export function hasMasterKey() { return Boolean(env.LITELLM_MASTER_KEY); }
