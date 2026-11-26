import type { NextConfig } from "next";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

// Dashboard ini aplikasi mandiri, tetapi operator sebelumnya menyimpan
// kredensial LiteLLM di .env.local repo induk. Ambil hanya dua variabel
// gateway yang diperlukan; jangan ikut memuat kredensial portal lainnya.
const parentEnv = path.resolve(__dirname, "../.env.local");
if (existsSync(parentEnv)) {
  const allowed = new Set(["LITELLM_BASE_URL", "LITELLM_MASTER_KEY"]);
  for (const rawLine of readFileSync(parentEnv, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    if (!allowed.has(name) || process.env[name]) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) process.env[name] = value;
  }
}

const config: NextConfig = { turbopack: { root: path.resolve(__dirname, "..") } };
export default config;
