import { getHealth, getKeys, getUsers } from "@/lib/mr-gateway";
import { session } from "@/lib/mr-auth";
import { KeyCreator } from "./key-creator";

function date(value: unknown) {
  if (typeof value !== "string" || !value) return "Tidak dibatasi";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(parsed);
}

export default async function Keys() {
  const [current, keysResult, usersResult, health] = await Promise.all([
    session(),
    getKeys().then((value) => ({ value, error: "" })).catch(() => ({ value: { keys: [] }, error: "Daftar key belum dapat dimuat. Periksa koneksi dan kredensial LiteLLM." })),
    getUsers().then((value) => value.users).catch(() => []),
    getHealth(),
  ]);
  const keys = keysResult.value.keys;
  const users = usersResult.map((user) => ({
    id: String(user.user_id ?? ""),
    label: String(user.user_email ?? user.user_id ?? "Developer"),
  })).filter((user) => user.id);
  const active = keys.filter((key) => key.blocked !== true).length;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#8c2835]">Akses gateway</p><h1 className="mt-1.5 text-[26px] font-semibold tracking-tight">API keys</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-[#6f7a88]">Terbitkan key per developer dan proyek. Nilai lengkap hanya ditampilkan sekali setelah key dibuat.</p></div><KeyCreator users={users} models={health.models} enabled={current?.role === "admin" && health.managementReady}/></div>
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-[#e5e9ed] bg-white px-4 py-3"><div className="text-[11px] text-[#7d8794]">Key terdaftar</div><div className="mt-1 text-xl font-semibold">{keys.length}</div></div><div className="rounded-xl border border-[#e5e9ed] bg-white px-4 py-3"><div className="text-[11px] text-[#7d8794]">Aktif</div><div className="mt-1 text-xl font-semibold text-[#218052]">{active}</div></div><div className="rounded-xl border border-[#e5e9ed] bg-white px-4 py-3"><div className="text-[11px] text-[#7d8794]">Diblokir</div><div className="mt-1 text-xl font-semibold text-[#9a3441]">{keys.length - active}</div></div></div>
    <section className="overflow-hidden rounded-xl border border-[#e5e9ed] bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0f3] px-5 py-4"><div><h2 className="text-sm font-semibold">Key yang diterbitkan</h2><p className="mt-1 text-xs text-[#7d8794]">Metadata dari LiteLLM; secret tidak disimpan atau ditampilkan ulang.</p></div><span className="text-[11px] text-[#7d8794]">{keys.length} dari maks. 100 ditampilkan</span></div>
      {keysResult.error ? <div className="m-5 rounded-lg border border-[#f1d8a7] bg-[#fff9e9] p-3 text-xs leading-5 text-[#765c27]">{keysResult.error}</div> : keys.length ? <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-xs"><thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[.08em] text-[#7d8794]"><tr>{["Alias", "Pemilik", "Model", "Batas RPM / TPM", "Berlaku sampai", "Status"].map((heading) => <th key={heading} className="px-5 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody>{keys.map((key, index) => { const blocked = key.blocked === true; return <tr key={String(key.token_id ?? key.key_alias ?? index)} className="border-t border-[#edf0f3] hover:bg-[#fbfcfd]"><td className="px-5 py-4"><div className="font-semibold text-[#27313e]">{String(key.key_alias ?? "Tanpa alias")}</div><div className="mt-1 font-mono text-[10px] text-[#929ba6]">{String(key.token_id ?? "ID tidak tersedia").slice(0, 16)}</div></td><td className="px-5 py-4 text-[#596575]">{String(key.user_id ?? "Belum dipetakan")}</td><td className="px-5 py-4 text-[#596575]">{Array.isArray(key.models) && key.models.length ? key.models.join(", ") : "Semua model"}</td><td className="px-5 py-4 tabular-nums text-[#596575]">{String(key.rpm_limit ?? "—")} / {String(key.tpm_limit ?? "—")}</td><td className="px-5 py-4 text-[#596575]">{date(key.expires)}</td><td className="px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${blocked ? "bg-[#fff0f2] text-[#9a3441]" : "bg-[#eaf6ef] text-[#218052]"}`}>{blocked ? "Diblokir" : "Aktif"}</span></td></tr>; })}</tbody></table></div> : <div className="grid min-h-64 place-items-center px-5 text-center"><div><div className="mx-auto grid size-11 place-items-center rounded-xl bg-[#f5f6f8] font-mono text-sm font-semibold text-[#7b8693]">KEY</div><h3 className="mt-3 text-sm font-semibold">Belum ada API key</h3><p className="mt-1 max-w-sm text-xs leading-5 text-[#7d8794]">Buat key pertama untuk memberi aplikasi akses terbatas ke model gateway.</p></div></div>}
    </section>
  </div>;
}
