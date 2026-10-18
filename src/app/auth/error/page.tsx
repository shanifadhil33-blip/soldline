import Link from 'next/link';
import { authErrorCopy } from '../../../lib/error-copy';
import { getLanguage } from '../../../lib/locale';

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const copy = authErrorCopy((await searchParams).error, await getLanguage());
  return <main className="mx-auto max-w-sm p-6" id="content">
    <h1 className="text-2xl font-semibold">{copy.title}</h1>
    <p className="mt-4">{copy.body}</p>
    <Link className="mt-6 inline-block rounded-sm bg-accent px-4 py-3 text-accent-ink" href={copy.action.href}>{copy.action.label}</Link>
    <Link className="mt-4 block underline" href={copy.home.href}>{copy.home.label}</Link>
  </main>;
}
