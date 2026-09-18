import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <div className="dashboard-scope">{children}</div>;
}
