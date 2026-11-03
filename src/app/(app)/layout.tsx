import { redirect } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { loadShell } from '../../server/shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const shell = await loadShell();
  if (!shell) redirect('/sign-in');
  return <AppShell {...shell}>{children}</AppShell>;
}
