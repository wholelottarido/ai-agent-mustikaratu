"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const nav = [
  ["/mr-ai-gateway", "Ikhtisar", "◫"],
  ["/mr-ai-gateway/developers", "Developer", "♙"],
  ["/mr-ai-gateway/keys", "API Keys", "⌘"],
  ["/mr-ai-gateway/usage", "Analitik penggunaan", "▥"],
  ["/mr-ai-gateway/logs", "Log permintaan", "≡"],
  ["/mr-ai-gateway/settings", "Kesehatan sistem", "⚙"],
] as const;

export function GatewayShell({ children, role }: { children: React.ReactNode; role: "admin" | "viewer" }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return <div className="gateway min-h-screen bg-[#f5f6f8] text-[#17202c]">
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-[#e5e8ed] bg-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-[76px] items-center gap-3 border-b border-[#edf0f3] px-6">
        <div className="grid size-9 place-items-center rounded-xl bg-[#8c2835] text-sm font-bold text-white">MR</div>
        <div><div className="text-sm font-semibold tracking-tight">MR AI Gateway</div><div className="mt-0.5 text-[11px] text-[#8993a1]">ADMIN CONSOLE</div></div>
      </div>
      <div className="px-4 pt-7 text-[10px] font-semibold uppercase tracking-[.14em] text-[#9aa3ae]">Workspace</div>
      <nav className="mt-2 space-y-1 px-3" aria-label="Navigasi utama">
        {nav.map(([href, label, icon]) => {
          const active = path === href || (href !== "/mr-ai-gateway" && path.startsWith(href));
          return <Link key={href} href={href as never} onClick={() => setOpen(false)} className={`flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition ${active ? "bg-[#f8edef] font-semibold text-[#8c2835]" : "text-[#687382] hover:bg-[#f6f7f9] hover:text-[#202a36]"}`}><span className="w-5 text-center text-base" aria-hidden="true">{icon}</span>{label}</Link>;
        })}
      </nav>
      <div className="mt-auto p-4">
        <div className="rounded-xl border border-[#edf0f3] bg-[#fafbfc] p-3">
          <div className="flex items-center gap-2 text-xs font-semibold"><span className="size-2 rounded-full bg-[#22a06b]"/> Lingkungan lokal</div>
          <div className="mt-1.5 text-[11px] leading-5 text-[#7d8794]">Akses melalui SSH tunnel di perangkat ini.</div>
        </div>
        <div className="mt-4 flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5"><div className="grid size-8 place-items-center rounded-full bg-[#e9edf3] text-xs font-semibold text-[#596575]">OP</div><div><div className="text-xs font-medium">Operator</div><div className="text-[10px] capitalize text-[#8993a1]">{role}</div></div></div>
          <form action="/mr-ai-gateway/api/logout" method="post"><button className="text-[11px] text-[#7d8794] hover:text-[#8c2835]">Keluar</button></form>
        </div>
      </div>
    </aside>
    {open && <button aria-label="Tutup navigasi" className="fixed inset-0 z-20 bg-black/25 lg:hidden" onClick={() => setOpen(false)}/>}
    <div className="lg:pl-[248px]">
      <header className="sticky top-0 z-10 flex h-[68px] items-center justify-between border-b border-[#e7eaee] bg-white/95 px-4 backdrop-blur sm:px-7">
        <div className="flex items-center gap-3"><button aria-label="Buka navigasi" className="rounded-md p-2 text-[#687382] hover:bg-[#f1f3f6] lg:hidden" onClick={() => setOpen(true)}>☰</button><div className="text-xs text-[#8893a1]">Mustika Ratu <span className="mx-1.5 text-[#c0c6ce]">/</span> <span className="text-[#303b48]">{nav.find(([href]) => href === path)?.[1] ?? "MR AI Gateway"}</span></div></div>
        <div className="flex items-center gap-2 rounded-full border border-[#e9edf1] px-3 py-1.5 text-[11px] text-[#687382]"><span className="size-1.5 rounded-full bg-[#22a06b]"/> Tunnel lokal</div>
      </header>
      <main className="mx-auto max-w-[1440px] p-4 sm:p-7 lg:p-9">{children}</main>
    </div>
  </div>;
}
