import { AuthProvider } from '@/context/AuthContext';
import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'TradePass | Contractor Compliance & OSHA Expiration Tracking Software',
  description: 'Automated trade license, OSHA certification, and liability insurance tracking for trade contractors. Get 30, 15, 7, and 1-day email alerts, shareable GC public passports, and instant compliance digests.',
  openGraph: {
    title: 'TradePass | Subcontractor Compliance & Job-Site Safety Tracking',
    description: 'Keep your entire crew 100% job-site compliant with automated email expiration alerts, multi-foreman accounts, and custom-branded GC clearance passports.',
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