import type { ReactNode } from "react";
import "./globals.css";
export const metadata = { title: "MR AI Gateway", description: "Dashboard lokal Mustika Ratu AI Gateway" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="id"><body>{children}</body></html>;
}
