"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import { Button, Callout, Field, FieldError, Input, Label, Separator } from "@repo/ui";
import { authClient } from "@/lib/auth-client";

function safeNext(value: string | null, fallback: string): string {
  // Only allow same-site relative redirects.
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

function GoogleButton({ callbackURL }: { callbackURL: string }) {
  const [loading, setLoading] = React.useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      loading={loading}
      onClick={async () => {
        setLoading(true);
        await authClient.signIn.social({ provider: "google", callbackURL });
        setLoading(false);
      }}
    >
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8Z" />
        <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2.1v2.8A11 11 0 0 0 12 23Z" />
        <path fill="#FBBC05" d="M5.7 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.6-2.8Z" />
        <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.1 7.1l3.6 2.8C6.6 7.3 9.1 5.4 12 5.4Z" />
      </svg>
      Continue with Google
    </Button>
  );
}

function Divider() {
  return (
    <div className="my-5 flex items-center gap-3 text-[11px] text-foreground-subtle uppercase">
      <Separator className="flex-1" /> or <Separator className="flex-1" />
    </div>
  );
}

// ----------------------------------------------------------------------------- Login

const loginSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export function LoginForm({ googleEnabled, demoCredentials }: { googleEnabled: boolean; demoCredentials?: { email: string; password: string } }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"), "/app");
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { error: signInError } = await authClient.signIn.email({ email: values.email, password: values.password, callbackURL: next });
    if (signInError) {
      setError(signInError.status === 403 ? "Verify your email address first — check your inbox." : (signInError.message ?? "Invalid email or password"));
      return;
    }
    router.push(next);
    router.refresh();
  });

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-[-0.01em]">Sign in</h1>
      <p className="mt-1 text-[13px] text-foreground-muted">Welcome back. Sign in to your workspace.</p>

      {demoCredentials ? (
        <Callout tone="accent" className="mt-5" title="Demo workspace available">
          <button
            type="button"
            className="text-left underline-offset-2 hover:underline"
            onClick={() => {
              form.setValue("email", demoCredentials.email);
              form.setValue("password", demoCredentials.password);
            }}
          >
            Use {demoCredentials.email}
          </button>
        </Callout>
      ) : null}

      <div className="mt-6">
        {googleEnabled ? (
          <>
            <GoogleButton callbackURL={next} />
            <Divider />
          </>
        ) : null}
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" aria-invalid={Boolean(form.formState.errors.email)} {...form.register("email")} />
            <FieldError>{form.formState.errors.email?.message}</FieldError>
          </Field>
          <Field>
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className="text-xs text-foreground-muted hover:text-foreground">
                Forgot password?
              </Link>
            </div>
            <Input id="password" type="password" autoComplete="current-password" aria-invalid={Boolean(form.formState.errors.password)} {...form.register("password")} />
            <FieldError>{form.formState.errors.password?.message}</FieldError>
          </Field>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Button type="submit" variant="primary" className="w-full" size="lg" loading={form.formState.isSubmitting}>
            Sign in
          </Button>
        </form>
      </div>
      <p className="mt-6 text-center text-[13px] text-foreground-muted">
        New here?{" "}
        <Link href="/signup" className="font-medium text-foreground hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------- Signup

const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters").max(128),
});

export function SignupForm({ googleEnabled, requireVerification }: { googleEnabled: boolean; requireVerification: boolean }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const form = useForm<z.infer<typeof signupSchema>>({ resolver: zodResolver(signupSchema), defaultValues: { name: "", email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { error: signUpError } = await authClient.signUp.email({ ...values, callbackURL: "/onboarding" });
    if (signUpError) {
      setError(signUpError.message ?? "Could not create your account");
      return;
    }
    if (requireVerification) {
      setSentTo(values.email);
      return;
    }
    router.push("/onboarding");
    router.refresh();
  });

  if (sentTo) {
    return (
      <div className="text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-accent-soft">
          <MailCheck className="size-5 text-accent-soft-foreground" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">Check your email</h1>
        <p className="mt-2 text-[13px] text-foreground-muted">
          We sent a verification link to <span className="font-medium text-foreground">{sentTo}</span>. Open it to finish setting up your account.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-[-0.01em]">Create your account</h1>
      <p className="mt-1 text-[13px] text-foreground-muted">Set up your workspace in a few minutes.</p>
      <div className="mt-6">
        {googleEnabled ? (
          <>
            <GoogleButton callbackURL="/onboarding" />
            <Divider />
          </>
        ) : null}
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field>
            <Label htmlFor="name">Full name</Label>
            <Input id="name" autoComplete="name" aria-invalid={Boolean(form.formState.errors.name)} {...form.register("name")} />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </Field>
          <Field>
            <Label htmlFor="email">Work email</Label>
            <Input id="email" type="email" autoComplete="email" aria-invalid={Boolean(form.formState.errors.email)} {...form.register("email")} />
            <FieldError>{form.formState.errors.email?.message}</FieldError>
          </Field>
          <Field>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="new-password" aria-invalid={Boolean(form.formState.errors.password)} {...form.register("password")} />
            <FieldError>{form.formState.errors.password?.message}</FieldError>
          </Field>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Button type="submit" variant="primary" className="w-full" size="lg" loading={form.formState.isSubmitting}>
            Create account
          </Button>
        </form>
      </div>
      <p className="mt-6 text-center text-[13px] text-foreground-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------- Forgot / reset

export function ForgotPasswordForm() {
  const [sent, setSent] = React.useState(false);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.email("Enter a valid email") })), defaultValues: { email: "" } });
  const onSubmit = form.handleSubmit(async ({ email }) => {
    // Always show the same confirmation so the form can't be used to enumerate accounts.
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setSent(true);
  });

  return (
    <div>
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-[13px] text-foreground-muted">We&apos;ll email you a link to choose a new password.</p>
      {sent ? (
        <Callout tone="success" className="mt-6" title="Check your inbox">
          If an account exists for that address, a reset link is on its way.
        </Callout>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
          <Field>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
            <FieldError>{form.formState.errors.email?.message}</FieldError>
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-[13px]">
        <Link href="/login" className="text-foreground-muted hover:text-foreground">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [error, setError] = React.useState<string | null>(params.get("error") ? "This reset link is invalid or has expired." : null);
  const form = useForm<{ password: string }>({
    resolver: zodResolver(z.object({ password: z.string().min(8, "At least 8 characters").max(128) })),
    defaultValues: { password: "" },
  });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    if (!token) return setError("This reset link is invalid or has expired.");
    const { error: resetError } = await authClient.resetPassword({ newPassword: password, token });
    if (resetError) return setError(resetError.message ?? "Could not reset password");
    router.push("/login");
  });

  return (
    <div>
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
        <Field>
          <Label htmlFor="password">New password</Label>
          <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
          <FieldError>{form.formState.errors.password?.message}</FieldError>
        </Field>
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting} disabled={!token}>
          Update password
        </Button>
      </form>
    </div>
  );
}
