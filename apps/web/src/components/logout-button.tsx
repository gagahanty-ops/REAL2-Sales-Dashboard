"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      className="button button-secondary"
      disabled={pending}
      onClick={logout}
      type="button"
    >
      {pending ? "Выходим…" : "Выйти"}
    </button>
  );
}
