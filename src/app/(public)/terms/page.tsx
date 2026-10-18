import type { Metadata } from 'next';
import { LegalPage } from '../../../components/legal-page';
import { getLanguage } from '../../../lib/locale';

export const metadata: Metadata = { title: 'Terms | Soldline' };

export default async function TermsPage() {
  return <LegalPage locale={await getLanguage()} kind="terms" />;
}
