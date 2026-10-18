import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic, Inter } from 'next/font/google';
import './globals.css';
import { getLanguage } from '../lib/locale';

const inter = Inter({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-inter' });
const arabic = IBM_Plex_Sans_Arabic({ subsets: ['arabic'], weight: '400', variable: '--font-plex-arabic' });

export const metadata: Metadata = {
  title: 'Soldline',
  description: 'Every deliverable you sell gets an owner, a deadline and an approval.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLanguage();
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={`${inter.variable} ${arabic.variable}`}>
      <body>{children}</body>
    </html>
  );
}
