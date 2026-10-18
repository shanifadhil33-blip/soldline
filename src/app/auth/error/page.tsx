import Link from 'next/link';
export default function AuthErrorPage() {
  return <main className="mx-auto max-w-sm p-6">
    <h1 className="text-2xl font-semibold">Soldline</h1>
    <p className="mt-4">We could not sign you in. Please try again.</p>
    <Link className="mt-6 inline-block rounded-sm bg-accent px-4 py-3 text-accent-ink" href="/sign-in">Try again</Link>
    <Link className="mt-4 block underline" href="/">Back to home</Link>
  </main>;
}
