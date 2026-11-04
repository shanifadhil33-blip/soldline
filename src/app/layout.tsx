import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from 'next/font/google';
import './globals.css';
import { getLanguage } from '../lib/locale';
import { PressFeedback } from '../components/press-feedback';

const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-plex', display: 'swap' });
const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['700'], variable: '--font-display', display: 'swap' });
const arabic = IBM_Plex_Sans_Arabic({ subsets: ['arabic'], weight: ['400', '600'], variable: '--font-plex-arabic', display: 'swap', preload: false });

export const metadata: Metadata = {
  title: 'Soldline',
  description: 'Sold work, ready to deliver.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLanguage();
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={`${plex.variable} ${display.variable} ${arabic.variable}`}>
      <body><PressFeedback />{children}</body>
    </html>
  );
}
