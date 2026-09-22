import Link from "next/link";
import { brand } from "@repo/config";
import { Logo } from "@/components/brand/logo";
import { AuthShowcase } from "@/components/marketing/auth-showcase";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <Link href="/" className="w-fit">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[360px] animate-rise">{children}</div>
        </div>
        <p className="text-xs text-foreground-subtle">
          © {new Date().getFullYear()} {brand.legalName}
        </p>
      </div>
      <AuthShowcase />
    </div>
  );
}
