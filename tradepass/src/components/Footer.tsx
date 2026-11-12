'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

export default function Footer() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  // Hide the global footer on auth routes (login/signup) where clean focus is needed
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  if (isAuthPage) return null;

  const isHomePage = pathname === '/';
  const currentYear = new Date().getFullYear();

  const handleSignOut = async () => {
    try {
      setSigningOut(true);
      await signOut(auth);
      router.push('/login');
    } catch (err) {
      console.error('Error signing out:', err);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <footer className="border-t border-slate-900 bg-slate-950 text-slate-400 text-xs py-12 px-6 mt-auto">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        
        {/* Brand Information */}
        <article className="flex flex-col items-center md:items-start space-y-2">
          {isHomePage ? (
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="inline-flex items-center bg-transparent border-0 p-0 cursor-pointer"
              aria-label="Scroll to top"
            >
              <div className="relative w-40 h-40 flex items-center justify-center -my-8">
                <Image 
                  src="/TradePass-logo.png" 
                  alt="TradePass Logo" 
                  width={160} 
                  height={160}
                  className="object-contain w-full h-full"
                />
              </div>
            </button>
          ) : (
            <Link href={user ? "/dashboard" : "/"} className="inline-flex items-center">
              <div className="relative w-40 h-40 flex items-center justify-center -my-8">
                <Image 
                  src="/TradePass-logo.png" 
                  alt="TradePass Logo" 
                  width={160} 
                  height={160}
                  className="object-contain w-full h-full"
                />
              </div>
            </Link>
          )}
          <p className="text-slate-500 text-center md:text-left">
            Automated compliance and job-site access management for trade contractors.
          </p>
        </article>

        {/* Dynamic Navigation Links */}
        <nav className="flex flex-wrap justify-center gap-6 font-medium items-center" aria-label="Footer Navigation">
          {isHomePage ? (
            <a href="#how-it-works" className="hover:text-white transition">
              How It Works
            </a>
          ) : (
            <Link href="/#how-it-works" className="hover:text-white transition">
              How It Works
            </Link>
          )}

          {isHomePage ? (
            <a href="#pricing" className="hover:text-white transition">
              Pricing
            </a>
          ) : (
            <Link href="/#pricing" className="hover:text-white transition">
              Pricing
            </Link>
          )}

          {user ? (
            <button 
              onClick={handleSignOut}
              disabled={signingOut}
              className="hover:text-white transition cursor-pointer bg-transparent border-0 text-slate-400 font-medium text-xs p-0 disabled:opacity-50"
            >
              {signingOut ? 'Signing out...' : 'Sign Out'}
            </button>
          ) : (
            <Link href="/login" className="hover:text-white transition">
              Log In
            </Link>
          )}
        </nav>

        {/* Copyright & Legal */}
        <div className="text-center md:text-right text-slate-500 space-y-1">
          <p>© {currentYear} TradePass Technologies, Inc. All rights reserved.</p>
          <div className="flex justify-center md:justify-end space-x-4 text-[11px]">
            <a href="#" className="hover:text-slate-400 transition">Privacy Policy</a>
            <span>•</span>
            <a href="#" className="hover:text-slate-400 transition">Terms of Service</a>
          </div>
        </div>

      </div>
    </footer>
  );
}