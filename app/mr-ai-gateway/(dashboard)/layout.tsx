import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { session } from "@/lib/mr-auth";
import { GatewayShell } from "../shell";

export default async function GatewayDashboardLayout({ children }: { children: ReactNode }) {
  const current = await session();
  if (!current) redirect("/mr-ai-gateway/login");
  return <GatewayShell role={current.role as "admin" | "viewer"}>{children}</GatewayShell>;
}
