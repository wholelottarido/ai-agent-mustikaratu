import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

const optionalPassword = z.preprocess(
  (value) => typeof value === "string" && value.trim().length >= 8 ? value : undefined,
  z.string().optional(),
);
const optionalSecret = z.preprocess(
  (value) => typeof value === "string" && value.trim().length >= 32 ? value : undefined,
  z.string().optional(),
);
const config = z.object({
  MR_GATEWAY_ADMIN_PASSWORD: optionalPassword,
  MR_GATEWAY_VIEWER_PASSWORD: optionalPassword,
  MR_GATEWAY_AUTH_SECRET: optionalSecret,
}).parse(process.env);
const cookieName = "mr_gateway_session";

function secret() {
  if (!config.MR_GATEWAY_AUTH_SECRET) throw new Error("MR_GATEWAY_AUTH_SECRET is not configured");
  return new TextEncoder().encode(config.MR_GATEWAY_AUTH_SECRET);
}
export function authConfigured() { return Boolean(config.MR_GATEWAY_ADMIN_PASSWORD && config.MR_GATEWAY_AUTH_SECRET); }
export async function login(password: string) {
  const parsed = z.string().min(1).safeParse(password);
  if (!parsed.success) return null;
  let role: "admin" | "viewer" | null = null;
  if (config.MR_GATEWAY_ADMIN_PASSWORD && parsed.data === config.MR_GATEWAY_ADMIN_PASSWORD) role = "admin";
  else if (config.MR_GATEWAY_VIEWER_PASSWORD && parsed.data === config.MR_GATEWAY_VIEWER_PASSWORD) role = "viewer";
  if (!role) return null;
  const token = await new SignJWT({ role }).setProtectedHeader({ alg: "HS256" }).setSubject("operator").setIssuedAt().setExpirationTime("8h").sign(secret());
  (await cookies()).set(cookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 8 * 60 * 60 });
  return role;
}
export async function session() {
  try {
    const token = (await cookies()).get(cookieName)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret());
    return payload.role === "admin" || payload.role === "viewer" ? { role: payload.role } : null;
  } catch { return null; }
}
export async function logout() { (await cookies()).delete(cookieName); }
