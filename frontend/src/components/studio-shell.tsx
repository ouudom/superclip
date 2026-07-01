"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Clapperboard,
  Download,
  Film,
  FolderOpen,
  Home,
  LogOut,
  Menu,
  PackageOpen,
  Settings,
  Sparkles,
  Workflow,
  UserCircle,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { signOut, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Create", icon: Home },
  { href: "/list", label: "Projects", icon: FolderOpen },
  { href: "/library", label: "Clips", icon: Film },
  { href: "/sources", label: "Sources", icon: PackageOpen },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/publishing", label: "Exports", icon: Download },
  { href: "/settings", label: "Settings", icon: Settings },
];

function StudioSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const userInitial =
    session?.user?.name?.charAt(0) || session?.user?.email?.charAt(0) || "S";

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    window.location.href = "/sign-in";
  };

  return (
    <aside className="flex h-full w-72 flex-col border-r border-slate-200/80 bg-white px-4 py-5">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-3 px-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white shadow-sm">
          <Clapperboard className="h-5 w-5" />
        </span>
        <span>
          <span className="block font-[var(--font-syne)] text-lg font-bold leading-5 text-slate-950">
            SupoClip
          </span>
          <span className="block text-xs font-medium text-cyan-700">TikTok studio</span>
        </span>
      </Link>

      <nav className="mt-8 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition",
                active
                  ? "bg-cyan-50 text-slate-950 shadow-[inset_0_0_0_1px_rgba(14,165,233,0.18)]"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-950",
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-cyan-600" : "text-slate-400")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-8 rounded-lg border border-lime-200 bg-lime-50 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-950">
          <Sparkles className="h-4 w-4 text-lime-600" />
          Repurpose fast
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-600">
          Drop a long video. Keep the best moments. Download vertical clips.
        </p>
      </div>

      <div className="mt-auto border-t border-slate-200 pt-4">
        {!mounted ? (
          <div className="h-[60px] rounded-lg bg-slate-50" />
        ) : session?.user ? (
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-sm font-bold uppercase text-slate-950 shadow-sm">
              {userInitial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-950">
                {session.user.name || "Creator"}
              </p>
              <p className="truncate text-xs text-slate-500">{session.user.email}</p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Link href="/sign-in" onClick={onNavigate}>
            <Button className="w-full bg-slate-950 hover:bg-slate-800">Sign in</Button>
          </Link>
        )}
      </div>
    </aside>
  );
}

export function StudioShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f7fbfb] text-slate-950">
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">
        <StudioSidebar />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-950/30"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full">
            <StudioSidebar onNavigate={() => setMobileOpen(false)} />
            <Button
              size="icon"
              variant="outline"
              className="absolute right-4 top-4 bg-white"
              onClick={() => setMobileOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <main className="lg:ml-72">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur">
          <div className="flex min-h-20 items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <Button
              variant="outline"
              size="icon"
              className="bg-white lg:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-[var(--font-syne)] text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                {title}
              </h1>
              {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <UserCircle className="hidden h-5 w-5 text-slate-300 sm:block" />
            </div>
          </div>
        </header>

        <div className="px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
