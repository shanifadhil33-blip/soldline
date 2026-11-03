import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from 'next/font/google';
import './globals.css';
import { getLanguage } from '../lib/locale';

const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex' });
const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-display' });
const arabic = IBM_Plex_Sans_Arabic({ subsets: ['arabic'], weight: ['400', '600'], variable: '--font-plex-arabic' });

export const metadata: Metadata = {
  title: 'Soldline',
  description: 'Sold work, ready to deliver.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLanguage();
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={`${plex.variable} ${display.variable} ${arabic.variable}`}>
      <body>{children}</body>
    </html>
  );
}
