import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

/**
 * Huruf portal.
 *
 * Bawaan sebelumnya Arial lewat `--font-sans`, yang bukan pilihan melainkan
 * sisa. Portal perusahaan memakai sans geometrik, jadi disamakan.
 *
 * `next/font` mengunduhnya saat BUILD dan menyajikannya dari server kita --
 * tidak ada permintaan ke Google waktu halaman dibuka, dan tidak ada
 * pergeseran tata letak waktu hurufnya selesai dimuat.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Portal AI Assistant",
  description: "Asisten data per departemen, menjawab dari database perusahaan.",
};

/**
 * Pasang tema SEBELUM halaman digambar.
 *
 * Kalau ini dilakukan di React (useEffect), halaman sempat tergambar dengan
 * tema bawaan dulu lalu berganti -- terlihat sebagai kedipan putih di mode
 * gelap. Skrip kecil yang jalan duluan mencegah itu.
 *
 * Nilai "sistem" (atau belum pernah memilih) sengaja TIDAK memasang atribut,
 * supaya @media (prefers-color-scheme) yang menentukan.
 */
const SKRIP_TEMA = `
try {
  var t = localStorage.getItem("tema");
  if (t === "terang" || t === "gelap") {
    document.documentElement.setAttribute("data-tema", t);
  }
} catch (e) {}
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      className={`h-full antialiased ${jakarta.variable}`}
      // suppressHydrationWarning: atribut data-tema dipasang skrip di bawah
      // sebelum React hidrasi, jadi HTML server & klien memang beda di sini.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SKRIP_TEMA }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
