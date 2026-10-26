import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Chat } from "./components/chat";
import { BarAtas } from "./components/bar-atas";
import { RailAgent } from "./components/rail-agent";
import { bacaToken, NAMA_COOKIE } from "@/lib/sesi";
import { daftarAgent, type DaftarAgent } from "@/lib/daftar-agent";
import { ambilDepartemen } from "@/voltagent";
import { modelDitawarkan } from "@/voltagent/models";

export default async function Home() {
  // proxy.ts sudah menjaga halaman ini, tapi sesi tetap dibaca lagi di sini --
  // kita butuh isinya (nama, departemen), dan tidak ada salahnya berlapis.
  const sesi = await bacaToken((await cookies()).get(NAMA_COOKIE)?.value);
  if (!sesi) redirect("/login");

  const dep = ambilDepartemen(sesi.departemen);

  // Daftar agent dibaca dari tabel konfigurasi + akses aplikasi orang ini.
  // Gagalnya tidak boleh menjatuhkan halaman: kalau database perusahaan
  // sedang tidak bisa dihubungi, chat-nya masih berguna — railnya saja yang
  // tidak muncul.
  const agent: DaftarAgent = await daftarAgent(sesi.idEmployee).catch((e: unknown) => {
    console.error("[beranda] gagal membaca daftar agent:", e);
    return { agent: [], terbuka: 0, contoh: [], siap: false };
  });

  return (
    <main className="flex h-dvh w-full flex-col">
      <BarAtas
        nama={sesi.nama}
        departemen={dep?.label ?? sesi.departemen}
        peran={sesi.peran}
        admin={sesi.admin}
      />
      {dep ? (
        <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3 pt-3">
          <RailAgent agent={agent.agent} terbuka={agent.terbuka} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Chat
              departemen={dep.label}
              contoh={agent.siap && agent.contoh.length > 0 ? agent.contoh : dep.contohPertanyaan}
              agent={agent.siap ? agent.agent : undefined}
              // Dihitung di SERVER: ketersediaan Qwen bergantung pada env
              // yang tidak boleh sampai ke peramban.
              modelDitawarkan={modelDitawarkan()}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-tinta-lemah">
          Departemen <code>{sesi.departemen}</code> belum terdaftar di sistem.
          <br />
          Hubungi admin.
        </div>
      )}
    </main>
  );
}
