import Link from "next/link";
import { getDailyActivity, getHealth, getKeys } from "@/lib/mr-gateway";

function Stat({ label, value, note, icon }: { label: string; value: string; note: string; icon: string }) {
  return <article className="rounded-xl border border-[#e7eaee] bg-white p-5"><div className="flex items-start justify-between"><div className="text-xs font-medium text-[#76818e]">{label}</div><div className="grid size-8 place-items-center rounded-lg bg-[#f6f0f1] text-sm text-[#8c2835]">{icon}</div></div><div className="mt-4 text-[26px] font-semibold tracking-tight text-[#27313e]">{value}</div><div className="mt-1 text-[11px] text-[#98a1ac]">{note}</div></article>;
}

const number = new Intl.NumberFormat("id-ID");

export default async function Overview() {
  const [health, activityResult, keysResult] = await Promise.all([
    getHealth(),
    getDailyActivity(7).then((value) => ({ value, error: false })).catch(() => ({ value: [], error: true })),
    getKeys().then((value) => ({ value, error: false })).catch(() => ({ value: { keys: [] }, error: true })),
  ]);
  const activity = activityResult.value;
  const totals = activity.reduce((sum, day) => ({
    requests: sum.requests + day.metrics.api_requests,
    prompt: sum.prompt + day.metrics.prompt_tokens,
    completion: sum.completion + day.metrics.completion_tokens,
    success: sum.success + day.metrics.successful_requests,
    failed: sum.failed + day.metrics.failed_requests,
  }), { requests: 0, prompt: 0, completion: 0, success: 0, failed: 0 });
  const activeKeys = keysResult.value.keys.filter((key) => key.blocked !== true).length;
  const maxTokens = Math.max(1, ...activity.map((day) => day.metrics.total_tokens));
  const today = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "Asia/Jakarta" }).format(new Date());

  return <div className="space-y-7">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-medium capitalize text-[#8c2835]">{today}</p><h1 className="mt-1 text-[26px] font-semibold tracking-tight">Ikhtisar gateway</h1><p className="mt-1 text-sm text-[#7b8693]">Ringkasan operasional LiteLLM dan model Qwen.</p></div><div className="flex h-10 items-center gap-2 rounded-lg border border-[#e3e7eb] bg-white px-3 text-xs text-[#586473]">Periode <span className="font-medium">7 hari</span></div></div>
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${health.connected ? "border-[#cce8da] bg-[#f1faf5]" : "border-[#f1d8a7] bg-[#fff9e9]"}`}><div className="flex items-center gap-2.5"><span className={`size-2 rounded-full ${health.connected ? "bg-[#22a06b]" : "bg-[#d29424]"}`}/><span className="text-sm font-medium">{health.connected ? "Gateway terhubung melalui tunnel lokal" : "Gateway belum terhubung"}</span></div><span className="text-xs text-[#788391]">{health.connected ? health.managementReady ? `DB ${health.database} · ${health.models.length} model terdaftar` : `DB ${health.database} · kredensial pengelolaan belum diisi` : "Pastikan SSH tunnel lokal aktif."}</span></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Total permintaan" value={activityResult.error ? "—" : number.format(totals.requests)} note={activityResult.error ? "Data penggunaan tidak tersedia" : `${number.format(totals.success)} sukses · ${number.format(totals.failed)} gagal`} icon="↗"/><Stat label="Token prompt" value={activityResult.error ? "—" : number.format(totals.prompt)} note="Akumulasi 7 hari" icon="↓"/><Stat label="Token output" value={activityResult.error ? "—" : number.format(totals.completion)} note="Akumulasi 7 hari" icon="↑"/><Stat label="Kunci aktif" value={keysResult.error ? "—" : number.format(activeKeys)} note={keysResult.error ? "Metadata key tidak tersedia" : `${number.format(keysResult.value.keys.length)} key terdaftar`} icon="⌘"/></div>
    <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
      <section className="rounded-xl border border-[#e7eaee] bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Tren penggunaan</h2><p className="mt-1 text-xs text-[#87919e]">Token prompt dan output per hari</p></div><span className="rounded-md bg-[#f4f5f7] px-2 py-1 text-[10px] text-[#788391]">Live · 7 hari</span></div>{activity.length ? <div className="mt-6 space-y-4">{activity.map((day) => <div key={day.date} className="grid grid-cols-[76px_1fr_64px] items-center gap-3"><span className="text-[11px] text-[#7d8794]">{new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${day.date}T00:00:00Z`))}</span><div className="flex h-3 overflow-hidden rounded-full bg-[#f1f3f5]"><span className="bg-[#a23a48]" style={{ width: `${(day.metrics.prompt_tokens / maxTokens) * 100}%` }}/><span className="bg-[#d9a0a8]" style={{ width: `${(day.metrics.completion_tokens / maxTokens) * 100}%` }}/></div><span className="text-right text-[11px] font-medium text-[#596575]">{number.format(day.metrics.total_tokens)}</span></div>)}</div> : <div className="mt-6 grid h-[215px] place-items-center rounded-lg border border-dashed border-[#e4e8ec] bg-[#fbfcfd]"><div className="text-center"><div className="mx-auto grid size-10 place-items-center rounded-xl bg-white text-lg text-[#a0a8b2]">▥</div><p className="mt-3 text-xs font-medium text-[#687382]">Belum ada aktivitas pada periode ini</p></div></div>}</section>
      <section className="rounded-xl border border-[#e7eaee] bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Model tersedia</h2><p className="mt-1 text-xs text-[#87919e]">Dari LiteLLM /v1/models</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${health.modelsAvailable ? "bg-[#eaf6ef] text-[#218052]" : "bg-[#fff4dd] text-[#8a671c]"}`}>{health.modelsAvailable ? "Live" : "Offline"}</span></div><div className="mt-5 space-y-2">{health.models.length ? health.models.map((model) => <div key={model} className="flex items-center justify-between rounded-lg border border-[#edf0f3] px-3 py-3"><div><div className="text-xs font-medium">{model}</div><div className="mt-1 text-[10px] text-[#8d97a3]">Served model</div></div><span className="size-2 rounded-full bg-[#22a06b]"/></div>) : <div className="rounded-lg border border-dashed border-[#e5e9ed] px-3 py-6 text-center text-xs text-[#8993a0]">Daftar model tidak tersedia</div>}</div></section>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e7eaee] bg-white px-5 py-4"><div><div className="text-sm font-medium">Kelola akses developer</div><div className="mt-1 text-xs text-[#85909d]">Profil, virtual keys, dan ringkasan pemakaian.</div></div><Link href="/keys" className="rounded-lg bg-[#8c2835] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#76202c]">Lihat API keys</Link></div>
  </div>;
}
