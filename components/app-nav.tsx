"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Chat" },
  { href: "/push", label: "Push" },
];

export function AppNav() {
  const pathname = usePathname() || "/";

  return (
    <header className="border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
        <span className="text-sm font-semibold uppercase tracking-wide text-foreground">
          UofD Demos
        </span>
        <nav aria-label="Demo navigation" className="flex items-center gap-2">
          {links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Button
                key={link.href}
                asChild
                size="sm"
                variant="ghost"
                className={cn(
                  "px-3",
                  isActive
                    ? "bg-blue-600 text-white shadow-sm hover:bg-blue-500"
                    : "hover:bg-muted"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <Link href={link.href}>{link.label}</Link>
              </Button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export default AppNav;
