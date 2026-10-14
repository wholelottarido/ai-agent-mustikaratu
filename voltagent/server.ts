/**
 * Server debug VoltAgent -- proses TERPISAH dari Next.js.
 *
 * Jalankan: npm run voltagent:run
 * Lalu buka https://console.voltagent.dev dan sambungkan ke http://localhost:3141
 * untuk melihat tool call, prompt, dan waktu tiap langkah.
 *
 * Semua departemen didaftarkan di sini supaya bisa dites satu per satu tanpa
 * perlu login. Ini HANYA untuk debug lokal -- di UI web, departemen selalu
 * ditentukan sesi login.
 *
 * JANGAN bikin VoltAgent/honoServer di dalam handler Next.js -- bentrok port.
 */
import { VoltAgent } from "@voltagent/core";
import { honoServer } from "@voltagent/server-hono";
import { semuaAgent } from "./agents";

new VoltAgent({
  agents: semuaAgent(),
  server: honoServer({ port: 3141 }),
});
