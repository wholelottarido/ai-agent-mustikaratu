import { redirect } from "next/navigation";
import { authConfigured } from "@/lib/mr-auth";
import { session } from "@/lib/mr-auth";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await session()) redirect("/mr-ai-gateway");
  const configured = authConfigured();
  const { error } = await searchParams;
  return <main className="gateway grid min-h-screen place-items-center bg-[#f5f6f8] p-5 text-[#17202c]"><section className="w-full max-w-[390px] rounded-2xl border border-[#e6e9ed] bg-white p-8 shadow-[0_16px_48px_rgba(20,30,45,.07)]">
    <div className="mb-7 flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-[#8c2835] text-sm font-bold text-white">MR</div><div className="text-base font-semibold">MR AI Gateway</div></div>
    <h1 className="text-xl font-semibold tracking-tight">Masuk ke dashboard</h1><p className="mt-1.5 text-sm text-[#778291]">Gunakan kata sandi operator yang dikonfigurasi lokal.</p>
    {!configured && <div className="mt-5 rounded-lg border border-[#f1d8a7] bg-[#fff9e9] p-3 text-xs leading-5 text-[#765c27]">Login belum dikonfigurasi. Isi <code>MR_GATEWAY_ADMIN_PASSWORD</code> dan <code>MR_GATEWAY_AUTH_SECRET</code> pada environment lokal.</div>}
    {error && <p role="alert" className="mt-4 text-sm text-[#a12f3e]">Kata sandi tidak cocok.</p>}
    <form action="/api/login" method="post" className="mt-6 space-y-4"><label className="block text-xs font-medium text-[#46515f]">Kata sandi<input autoComplete="current-password" required type="password" name="password" disabled={!configured} className="mt-1.5 h-11 w-full rounded-lg border border-[#dfe4e9] px-3 text-sm outline-none focus:border-[#8c2835] focus:ring-2 focus:ring-[#8c2835]/10 disabled:bg-[#f3f4f6]"/></label><button disabled={!configured} className="h-11 w-full rounded-lg bg-[#8c2835] text-sm font-semibold text-white hover:bg-[#76202c] disabled:cursor-not-allowed disabled:opacity-50">Masuk</button></form>
    <p className="mt-5 text-center text-[11px] leading-5 text-[#8b95a1]">Sesi berlaku 8 jam · akses hanya melalui tunnel lokal</p>
  </section></main>;
}
