import type { Metadata } from 'next';
import Script from 'next/script';
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from 'next/font/google';
import NightshiftTransition from './components/nightshift-transition';
import ThemeToggle from './components/theme-toggle';
import './globals.css';

// Nightshift presentation fonts; no impact on application data or routing.
const bricolage = Bricolage_Grotesque({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['600', '700', '800'],
});

const inter = Inter({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

const jetBrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'ZOS — Zobocon Operating System',
  description: 'Zobocon painting operations platform',
};

const themeInitializationScript = `
  (function () {
    try {
      var savedTheme = localStorage.getItem('zos_theme');
      var theme = savedTheme === 'light' || savedTheme === 'dark'
        ? savedTheme
        : 'dark';
      var root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(theme);
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
    } catch (error) {
      document.documentElement.classList.add('dark');
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.style.colorScheme = 'dark';
    }
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bricolage.variable} ${inter.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <body className="nightshift-app flex min-h-full flex-col bg-slate-950 font-body text-white">
        <Script id="zos-theme-init" strategy="beforeInteractive">
          {themeInitializationScript}
        </Script>
        {children}
        <NightshiftTransition />
        <ThemeToggle />
      </body>
    </html>
  );
}