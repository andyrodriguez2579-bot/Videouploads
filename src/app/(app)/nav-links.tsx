"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/episodes", label: "Episodes" },
  { href: "/review", label: "Review queue" },
  { href: "/assets", label: "Asset library" },
  { href: "/renders", label: "Render center" },
  { href: "/calendar", label: "Publishing calendar" },
  { href: "/social", label: "Social accounts" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <ul className="space-y-0.5">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`block rounded-md px-3 py-2 text-sm ${
                active ? "bg-indigo-50 font-medium text-indigo-800" : "text-ink hover:bg-black/5"
              }`}
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
