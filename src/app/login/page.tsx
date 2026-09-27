import { redirect } from "next/navigation";
import EmailCodeForm from "@/components/EmailCodeForm";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { getCurrentUser } from "@/lib/auth";

/** Sign-in page: Google (when configured) or an email one-time code. */
export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  const googleClientId = process.env.GOOGLE_CLIENT_ID;

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-3xl">Sign in</h1>
        <p className="mt-1 text-sm text-stone-600">
          New here? Signing in creates your account. Nothing to fill in first.
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold">Use your Google account</h2>
        {googleClientId ? (
          <GoogleSignInButton clientId={googleClientId} />
        ) : (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Google sign-in is not configured yet. Set <code>GOOGLE_CLIENT_ID</code> in{" "}
            <code>.env.local</code> (see <code>.env.example</code>) to enable it.
          </p>
        )}
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold">Or continue with your email</h2>
        <EmailCodeForm />
      </div>
    </div>
  );
}
