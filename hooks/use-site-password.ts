"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "site:password";

export function useSitePasswordGate() {
  const sitePassword = process.env.NEXT_PUBLIC_SITE_PASSWORD;
  const [authorized, setAuthorized] = useState<boolean>(() => !sitePassword);

  useEffect(() => {
    if (!sitePassword) {
      setAuthorized(true);
      return;
    }

    let cancelled = false;

    const markAuthorized = (value: boolean) => {
      if (!cancelled) setAuthorized(value);
    };

    const ask = () => {
      if (cancelled) return;
      const input = window.prompt("Enter site password:") ?? null;
      if (input === null) {
        markAuthorized(false);
        return;
      }
      if (input === sitePassword) {
        try {
          localStorage.setItem(STORAGE_KEY, input);
        } catch {}
        markAuthorized(true);
      } else {
        alert("Incorrect password");
        setTimeout(ask, 0);
      }
    };

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === sitePassword) {
        markAuthorized(true);
        return () => {
          cancelled = true;
        };
      }
    } catch {}

    markAuthorized(false);
    ask();

    return () => {
      cancelled = true;
    };
  }, [sitePassword]);

  return authorized;
}
