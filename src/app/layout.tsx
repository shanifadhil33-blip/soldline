import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic, Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-inter' });
const arabic = IBM_Plex_Sans_Arabic({ subsets: ['arabic'], weight: '400', variable: '--font-plex-arabic' });

export const metadata: Metadata = {
  title: 'Soldline',
  description: 'Every deliverable you sell gets an owner, a deadline and an approval.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${arabic.variable}`}>
      <body>{children}</body>
    </html>
  );
}
