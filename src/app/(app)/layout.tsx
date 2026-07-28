import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";

import { signOutAction } from "../login/actions";
import { NavLinks } from "./nav-links";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only-focusable btn-primary absolute left-3 top-3 z-50">
        Skip to main content
      </a>

      <header className="border-b border-black/10 bg-white lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between p-4 lg:block">
          <Link href="/dashboard" className="block">
            <span className="font-serif text-lg font-semibold">Historia Dominicana</span>
            <span className="block text-xs text-black/50">Studio</span>
          </Link>
        </div>

        <nav aria-label="Main" className="px-2 pb-4">
          <NavLinks />
        </nav>

        <div className="border-t border-black/10 p-4 text-sm lg:mt-auto">
          <p className="font-medium">{user.displayName}</p>
          <p className="text-xs text-black/50">
            {user.email} · {user.role}
          </p>
          <form action={signOutAction} className="mt-2">
            <button type="submit" className="link text-sm">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main id="main" className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}
