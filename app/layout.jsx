import { Archivo, Space_Mono } from 'next/font/google';
import './globals.css';

const sans = Archivo({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '700', '800', '900'],
});

const mono = Space_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '700'],
});

export const metadata = {
  title: 'Xean Digital AI',
  description: 'Chat AI dengan panel artifact untuk kode dan berkas, bergaya Neobrutalism.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="id" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
