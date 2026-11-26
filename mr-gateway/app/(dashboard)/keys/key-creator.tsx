"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type UserOption = { id: string; label: string };

export function KeyCreator({ users, models, enabled }: { users: UserOption[]; models: string[]; enabled: boolean }) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const aliasRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [issuedKey, setIssuedKey] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && !issuedKey) aliasRef.current?.focus();
  }, [open, issuedKey]);

  function close() {
    if (submitting) return;
    setOpen(false);
    setError("");
    setIssuedKey("");
    setCopied(false);
    router.refresh();
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const optionalNumber = (name: string) => {
      const value = String(form.get(name) ?? "").trim();
      return value ? Number(value) : undefined;
    };
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          user_id: String(form.get("user_id") ?? ""),
          key_alias: String(form.get("key_alias") ?? "").trim(),
          models: [String(form.get("model") ?? "")],
          duration: String(form.get("duration") ?? "") || undefined,
          rpm_limit: optionalNumber("rpm_limit"),
          tpm_limit: optionalNumber("tpm_limit"),
          max_parallel_requests: optionalNumber("max_parallel_requests"),
        }),
      });
      const body = await response.json() as { key?: string; error?: string };
      if (!response.ok || !body.key) throw new Error(body.error ?? "Key tidak berhasil dibuat.");
      setIssuedKey(body.key);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Key tidak berhasil dibuat. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(issuedKey);
      setCopied(true);
    } catch {
      setError("Salin otomatis gagal. Pilih key lalu salin secara manual.");
    }
  }

  const unavailableReason = !enabled ? "Hanya admin dengan kredensial pengelolaan yang dapat membuat key." : users.length === 0 ? "Buat atau hubungkan developer sebelum menerbitkan key." : models.length === 0 ? "Tidak ada model yang tersedia dari gateway." : "";
  const canCreate = enabled && users.length > 0 && models.length > 0;

  return <>
    <div className="flex flex-col items-end gap-1.5">
      <button ref={triggerRef} type="button" disabled={!canCreate} onClick={() => setOpen(true)} className="min-h-10 rounded-lg bg-[#8c2835] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#76202c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8c2835] disabled:cursor-not-allowed disabled:bg-[#d6bfc3]">Buat API key</button>
      {unavailableReason && <span className="max-w-64 text-right text-[10px] leading-4 text-[#7d8794]">{unavailableReason}</span>}
    </div>
    {open && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#111827]/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !issuedKey) close(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="key-dialog-title" className="w-full max-w-xl rounded-2xl border border-[#e1e5ea] bg-white shadow-[0_24px_80px_rgba(18,28,42,.22)]">
        {issuedKey ? <div className="p-6 sm:p-7">
          <div className="grid size-10 place-items-center rounded-full bg-[#eaf6ef] text-lg font-semibold text-[#218052]" aria-hidden="true">✓</div>
          <h2 id="key-dialog-title" className="mt-4 text-xl font-semibold tracking-tight">API key berhasil dibuat</h2>
          <p className="mt-2 text-sm leading-6 text-[#687382]">Simpan key ini sekarang. Setelah dialog ditutup, nilai lengkapnya tidak dapat ditampilkan lagi.</p>
          <label className="mt-5 block text-xs font-semibold text-[#46515f]">Key baru<textarea readOnly value={issuedKey} onFocus={(event) => event.currentTarget.select()} className="mt-2 min-h-24 w-full resize-none rounded-lg border border-[#dfe4e9] bg-[#f8f9fa] p-3 font-mono text-xs leading-5 text-[#27313e] outline-none focus:border-[#8c2835]"/></label>
          {error && <p role="alert" className="mt-3 text-xs text-[#a12f3e]">{error}</p>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={close} className="min-h-10 rounded-lg border border-[#dfe4e9] px-4 text-xs font-semibold text-[#46515f] hover:bg-[#f7f8fa]">Sudah disimpan, tutup</button><button type="button" onClick={copyKey} className="min-h-10 rounded-lg bg-[#8c2835] px-4 text-xs font-semibold text-white hover:bg-[#76202c]">{copied ? "Tersalin" : "Salin key"}</button></div>
        </div> : <form onSubmit={submit}>
          <div className="border-b border-[#edf0f3] px-6 py-5 sm:px-7"><div className="flex items-start justify-between gap-4"><div><h2 id="key-dialog-title" className="text-lg font-semibold tracking-tight">Buat API key</h2><p className="mt-1 text-xs leading-5 text-[#7b8693]">Tentukan pemilik dan batas akses untuk key baru.</p></div><button type="button" onClick={close} className="grid size-9 shrink-0 place-items-center rounded-lg text-lg text-[#7b8693] hover:bg-[#f2f4f6]" aria-label="Tutup dialog">×</button></div></div>
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2 sm:px-7">
            <label className="block text-xs font-semibold text-[#46515f] sm:col-span-2">Alias key<span className="text-[#a12f3e]"> *</span><input ref={aliasRef} required name="key_alias" maxLength={64} placeholder="Contoh: aplikasi-inventori" className="mt-2 h-11 w-full rounded-lg border border-[#dfe4e9] px-3 text-sm font-normal outline-none placeholder:text-[#a0a8b2] focus:border-[#8c2835] focus:ring-2 focus:ring-[#8c2835]/10"/><span className="mt-1.5 block font-normal leading-4 text-[#8b95a1]">Gunakan nama proyek atau layanan agar mudah dikenali.</span></label>
            <label className="block text-xs font-semibold text-[#46515f]">Developer<span className="text-[#a12f3e]"> *</span><select required name="user_id" defaultValue={users[0]?.id} className="mt-2 h-11 w-full rounded-lg border border-[#dfe4e9] bg-white px-3 text-sm font-normal outline-none focus:border-[#8c2835]">{users.map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}</select></label>
            <label className="block text-xs font-semibold text-[#46515f]">Model yang diizinkan<span className="text-[#a12f3e]"> *</span><select required name="model" defaultValue={models[0]} className="mt-2 h-11 w-full rounded-lg border border-[#dfe4e9] bg-white px-3 text-sm font-normal outline-none focus:border-[#8c2835]">{models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
            <label className="block text-xs font-semibold text-[#46515f]">Masa berlaku<select name="duration" defaultValue="30d" className="mt-2 h-11 w-full rounded-lg border border-[#dfe4e9] bg-white px-3 text-sm font-normal outline-none focus:border-[#8c2835]"><option value="7d">7 hari</option><option value="30d">30 hari</option><option value="90d">90 hari</option><option value="">Tidak dibatasi</option></select></label>
            <label className="block text-xs font-semibold text-[#46515f]">Maks. request/menit<input name="rpm_limit" inputMode="numeric" type="number" min="1" placeholder="Opsional" className="mt-2 h-11 w-full rounded-lg border border-[#dfe4e9] px-3 text-sm font-normal outline-none placeholder:text-[#a0a8b2] focus:border-[#8c2835]"/></label>
            <label className="block text-xs font-semibold text-[#46515f]">Maks. token/menit<input name="tpm_limit" inputMode="numeric" type="number" min="1" placeholder="Opsional" className="mt-2 h-11 w-full rounded-lg border border-[#dfe4e9] px-3 text-sm font-normal outline-none placeholder:text-[#a0a8b2] focus:border-[#8c2835]"/></label>
            <label className="block text-xs font-semibold text-[#46515f]">Maks. permintaan bersamaan<input name="max_parallel_requests" inputMode="numeric" type="number" min="1" placeholder="Opsional" className="mt-2 h-11 w-full rounded-lg border border-[#dfe4e9] px-3 text-sm font-normal outline-none placeholder:text-[#a0a8b2] focus:border-[#8c2835]"/></label>
          </div>
          {error && <div role="alert" className="mx-6 mb-1 rounded-lg border border-[#f1c8ce] bg-[#fff4f5] px-3 py-2.5 text-xs leading-5 text-[#942c3a] sm:mx-7">{error}</div>}
          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-[#edf0f3] px-6 py-4 sm:flex-row sm:justify-end sm:px-7"><button type="button" onClick={close} disabled={submitting} className="min-h-10 rounded-lg border border-[#dfe4e9] px-4 text-xs font-semibold text-[#46515f] hover:bg-[#f7f8fa] disabled:opacity-50">Batal</button><button type="submit" disabled={submitting} className="min-h-10 rounded-lg bg-[#8c2835] px-4 text-xs font-semibold text-white hover:bg-[#76202c] disabled:cursor-wait disabled:opacity-60">{submitting ? "Membuat key…" : "Buat key"}</button></div>
        </form>}
      </section>
    </div>}
  </>;
}
