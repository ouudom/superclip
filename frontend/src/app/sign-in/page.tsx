import { SignIn } from "@/components/auth/sign-in";
import { Clapperboard } from "lucide-react";
import Link from "next/link";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7fbfb] px-4 py-12 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-slate-950 text-white shadow-sm">
            <Clapperboard className="h-7 w-7" />
          </div>
          <h1 className="mt-4 font-[var(--font-syne)] text-3xl font-bold text-slate-950">SupoClip</h1>
          <p className="mt-2 text-sm text-cyan-700">Video repurposing studio</p>
        </div>
        <SignIn />
        <div className="text-center">
          <p className="text-sm text-gray-600">
            Don&apos;t have an account?{" "}
            <Link href="/sign-up" className="font-medium text-cyan-700 hover:text-cyan-600">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
