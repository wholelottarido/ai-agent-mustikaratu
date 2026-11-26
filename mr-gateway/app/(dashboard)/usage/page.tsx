import { getDailyActivity } from "@/lib/mr-gateway";

const number = new Intl.NumberFormat("id-ID");

export default async function Usage() {
  const activity = await getDailyActivity(7).catch(() => []);
  const totals = activity.reduce((sum, day) => ({
    requests: sum.requests + day.metrics.api_requests,
    prompt: sum.prompt + day.metrics.prompt_tokens,
    completion: sum.completion + day.metrics.completion_tokens,
    failed: sum.failed + day.metrics.failed_requests,
  }), { requests: 0, prompt: 0, completion: 0, failed: 0 });
  const max = Math.max(1, ...activity.map((day) => day.metrics.total_tokens));

  return <div className="space-y-6"><div><h1 className="text-[26px] font-semibold tracking-tight">Analitik penggunaan</h1><p className="mt-1 text-sm text-[#7b8693]">Pemakaian token dan permintaan dari aktivitas harian LiteLLM.</p></div><div className="flex flex-wrap gap-3"><div className="rounded-lg border border-[#e3e7eb] bg-white px-3 py-2 text-xs">7 hari terakhir</div><div className="rounded-lg border border-[#e3e7eb] bg-white px-3 py-2 text-xs">Semua developer dan model</div></div><div className="grid gap-4 sm:grid-cols-3"><div className="rounded-xl border border-[#e7eaee] bg-white p-5"><div className="text-xs text-[#7b8693]">Permintaan tercatat</div><div className="mt-3 text-2xl font-semibold">{number.format(totals.requests)}</div><div className="mt-1 text-[11px] text-[#98a1ac]">{number.format(totals.failed)} permintaan gagal</div></div><div className="rounded-xl border border-[#e7eaee] bg-white p-5"><div className="text-xs text-[#7b8693]">Token prompt</div><div className="mt-3 text-2xl font-semibold">{number.format(totals.prompt)}</div><div className="mt-1 text-[11px] text-[#98a1ac]">Akumulasi 7 hari</div></div><div className="rounded-xl border border-[#e7eaee] bg-white p-5"><div className="text-xs text-[#7b8693]">Token output</div><div className="mt-3 text-2xl font-semibold">{number.format(totals.completion)}</div><div className="mt-1 text-[11px] text-[#98a1ac]">Akumulasi 7 hari</div></div></div><div className="rounded-xl border border-[#e7eaee] bg-white p-5"><div className="text-sm font-semibold">Volume harian</div><div className="mt-1 text-xs text-[#87919e]">Token prompt dan output</div>{activity.length ? <div className="mt-6 space-y-4">{activity.map((day) => <div key={day.date} className="grid grid-cols-[80px_1fr_70px] items-center gap-3"><span className="text-[11px] text-[#7d8794]">{day.date}</span><div className="flex h-4 overflow-hidden rounded-full bg-[#f1f3f5]"><span className="bg-[#a23a48]" style={{ width: `${day.metrics.prompt_tokens / max * 100}%` }}/><span className="bg-[#d9a0a8]" style={{ width: `${day.metrics.completion_tokens / max * 100}%` }}/></div><span className="text-right text-[11px] font-medium">{number.format(day.metrics.total_tokens)}</span></div>)}</div> : <div className="mt-5 grid h-[250px] place-items-center rounded-lg border border-dashed border-[#e4e8ec] bg-[#fbfcfd]"><p className="text-xs text-[#687382]">Belum ada aktivitas pada periode ini.</p></div>}</div></div>;
}
