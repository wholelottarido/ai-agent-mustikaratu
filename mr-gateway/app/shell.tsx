"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const nav = [
  ["/", "Ikhtisar", "overview"],
  ["/developers", "Developer", "users"],
  ["/keys", "API keys", "key"],
  ["/usage", "Analitik penggunaan", "chart"],
  ["/logs", "Log permintaan", "logs"],
  ["/settings", "Kesehatan sistem", "settings"],
] as const;

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M15 8l3 3M18 5l2 2"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/></>,
    logs: <><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 15.5l1.5 1.5-3.5 3.5-1.5-1.5a8 8 0 0 1-2 .8V22h-5v-2.2a8 8 0 0 1-2-.8L5 20.5 1.5 17 3 15.5a8 8 0 0 1-.8-2H0v-5h2.2a8 8 0 0 1 .8-2L1.5 5 5 1.5 6.5 3a8 8 0 0 1 2-.8V0h5v2.2a8 8 0 0 1 2 .8L17 1.5 20.5 5 19 6.5a8 8 0 0 1 .8 2H22v5h-2.2a8 8 0 0 1-.8 2Z" transform="translate(1 1) scale(.92)"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-[18px]" aria-hidden="true">{paths[name]}</svg>;
}

export function GatewayShell({ children, role }: { children: React.ReactNode; role: "admin" | "viewer" }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const currentLabel = nav.find(([href]) => href === path)?.[1] ?? "MR AI Gateway";
  return <div className="min-h-screen bg-[#f4f5f7] text-[#17202c]">
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-[#e4e8ec] bg-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-[76px] items-center border-b border-[#edf0f3] px-6"><div><div className="text-[15px] font-semibold tracking-tight text-[#71202b]">MR AI Gateway</div><div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[#8993a1]">Admin console</div></div></div>
      <div className="px-4 pt-7 text-[10px] font-semibold uppercase tracking-[.14em] text-[#9aa3ae]">Menu utama</div>
      <nav className="mt-2 space-y-1 px-3" aria-label="Navigasi utama">{nav.map(([href, label, icon]) => { const active = path === href || (href !== "/" && path.startsWith(href)); return <Link key={href} href={href as never} onClick={() => setOpen(false)} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] transition ${active ? "bg-[#f8edef] font-semibold text-[#8c2835]" : "text-[#687382] hover:bg-[#f6f7f9] hover:text-[#202a36]"}`}><NavIcon name={icon}/>{label}</Link>; })}</nav>
      <div className="mt-auto p-4"><div className="rounded-xl border border-[#edf0f3] bg-[#fafbfc] p-3"><div className="flex items-center gap-2 text-xs font-semibold"><span className="size-2 rounded-full bg-[#22a06b]"/> Tunnel lokal aktif</div><div className="mt-1.5 text-[11px] leading-5 text-[#6f7a88]">Gateway hanya tersedia dari perangkat ini.</div></div><div className="mt-4 flex items-center justify-between px-1"><div className="flex items-center gap-2.5"><div className="grid size-8 place-items-center rounded-full bg-[#e9edf3] text-xs font-semibold text-[#596575]">OP</div><div><div className="text-xs font-medium">Operator</div><div className="text-[10px] capitalize text-[#8993a1]">{role}</div></div></div><form action="/api/logout" method="post"><button className="min-h-9 px-1 text-[11px] font-medium text-[#6f7a88] hover:text-[#8c2835]">Keluar</button></form></div></div>
    </aside>
    {open && <button aria-label="Tutup navigasi" className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)}/>}
    <div className="lg:pl-[248px]"><header className="sticky top-0 z-10 flex h-[68px] items-center justify-between border-b border-[#e7eaee] bg-white/95 px-4 backdrop-blur sm:px-7"><div className="flex items-center gap-3"><button aria-label="Buka navigasi" className="grid size-10 place-items-center rounded-md text-[#687382] hover:bg-[#f1f3f6] lg:hidden" onClick={() => setOpen(true)}><span className="space-y-1" aria-hidden="true"><span className="block h-px w-4 bg-current"/><span className="block h-px w-4 bg-current"/><span className="block h-px w-4 bg-current"/></span></button><div className="text-xs text-[#8893a1]">Mustika Ratu <span className="mx-1.5 text-[#c0c6ce]">/</span> <span className="font-medium text-[#303b48]">{currentLabel}</span></div></div><div className="flex items-center gap-2 rounded-full border border-[#e9edf1] px-3 py-1.5 text-[11px] text-[#687382]"><span className="size-1.5 rounded-full bg-[#22a06b]"/> Live</div></header><main className="mx-auto max-w-[1440px] p-4 sm:p-7 lg:p-9">{children}</main></div>
  </div>;
}
