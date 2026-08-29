import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata: Metadata = { title: "Sign up — SignSpeak" };

export default function RegisterPage() {
  return (
    <AuthShell
      title="Registration is temporarily closed"
      subtitle="We're not accepting new accounts right now."
    >
      <p className="text-center text-sm text-foreground-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
