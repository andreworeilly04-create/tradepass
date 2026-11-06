import { AuthProvider } from '@/context/AuthContext';
import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'TradePass | Automated Contractor License & Insurance Tracker',
  description:
    'Automate trade license, OSHA certification, and liability insurance tracking for sub-contractors. Get 30-day SMS alerts before expensive job-site shutdowns.',
  openGraph: {
    title: 'TradePass | Contractor Compliance Made Easy',
    description:
      'Keep your entire crew 100% job-site compliant with automated SMS alerts before licenses, insurance binders, and OSHA certs expire.',
    url: 'https://gettradepass.com',
    siteName: 'TradePass',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="bg-slate-950 text-slate-100 flex flex-col min-h-screen font-sans antialiased">
        <AuthProvider>
          <Header />
          <div className="flex-grow flex flex-col">{children}</div>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}