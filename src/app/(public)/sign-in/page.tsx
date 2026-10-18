import Link from 'next/link';
import { GoogleButton } from './GoogleButton';
export default function SignInPage() {
  return <main className="mx-auto max-w-sm p-6">
    <h1 className="text-2xl font-semibold">Soldline</h1>
    <p className="mt-4">Sign in to your workspace.</p>
    <GoogleButton />
    <Link className="mt-4 block underline" href="/demo">Try the demo</Link>
    <p className="mt-6 legal-links"><Link className="underline" href="/privacy">Privacy</Link><Link className="underline" href="/terms">Terms</Link></p>
  </main>;
}
