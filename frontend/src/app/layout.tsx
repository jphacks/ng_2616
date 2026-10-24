import 'katex/dist/katex.min.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_JP } from 'next/font/google';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const notoJp = Noto_Sans_JP({ subsets: ['latin'], variable: '--font-noto-jp', display: 'swap', weight: ['400', '500', '600'] });

export const metadata: Metadata = {
  title: 'Math Notebook',
  description: 'Handwritten derivations, checked step by step.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${notoJp.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
