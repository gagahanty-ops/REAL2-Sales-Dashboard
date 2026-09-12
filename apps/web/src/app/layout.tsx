import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "РЕАЛ ДВА — дашборд отдела продаж",
  description: "Закрытый аналитический дашборд отдела продаж РЕАЛ ДВА",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
