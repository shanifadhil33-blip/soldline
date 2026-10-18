import type { Metadata } from 'next';
import { LegalPage } from '../../../components/legal-page';
import { getLanguage } from '../../../lib/locale';

export const metadata: Metadata = { title: 'Privacy | Soldline' };

export default async function PrivacyPage() {
  return <LegalPage locale={await getLanguage()} kind="privacy" />;
}
