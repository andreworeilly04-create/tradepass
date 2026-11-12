'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { ExternalLink, Settings, LogOut, Lock, Check } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

interface UserProfile {
  companyName?: string;
  planTier?: string;
}

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const isDashboard = pathname.startsWith('/dashboard') || pathname.startsWith('/settings');
  const isHomePage = pathname === '/';

  // Fetch Firestore User Profile dynamically & wipe state if user logs out / changes
  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        setProfile(snapshot.data() as UserProfile);
      } else {
        setProfile(null);
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Derive dynamic initials
  const getInitials = (name?: string | null, email?: string | null) => {
    if (name) {
      const parts = name.trim().split(' ');
      if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      return parts[0].substring(0, 2).toUpperCase();
    }
    if (email) return email.substring(0, 2).toUpperCase();
    return 'TP';
  };

  const handleSignOut = async () => {
    try {
      setSigningOut(true);
      setProfile(null);
      await signOut(auth);
      router.push('/login');
    } catch (err) {
      console.error('Error signing out:', err);
    } finally {
      setSigningOut(false);
    }
  };

  const handleCopyPublicLink = () => {
    if (!user) return;
    const passportUrl = `${window.location.origin}/passport/${user.uid}`;
    navigator.clipboard.writeText(passportUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 3000);
  };

  if (isAuthPage) return null;

  const rawTier = (profile?.planTier || 'Standard Crew').toLowerCase();
  const isStandardTier = rawTier.includes('standard');
  const isEnterpriseTier = rawTier.includes('enterprise');
  const planTierDisplay = isEnterpriseTier ? 'Multi-Crew Enterprise' : isStandardTier ? 'Standard Crew' : 'Crew Pro';
  const userInitials = getInitials(profile?.companyName || user?.displayName, user?.email);

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-50 px-6 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        
        {/* Brand Logo & Dynamic Plan Badge */}
        <div className="flex items-center space-x-3">
          {isHomePage ? (
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="flex items-center bg-transparent border-0 p-0 cursor-pointer"
              aria-label="Scroll to top"
            >
              <div className="relative w-52 h-16 flex items-center justify-center">
                <Image 
                  src="/TradePass-logo.png" 
                  alt="TradePass Logo" 
                  width={220} 
                  height={70}
                  className="object-contain w-full h-full"
                  priority
                />
              </div>
            </button>
          ) : (
            <Link href={user ? "/dashboard" : "/"} className="flex items-center">
              <div className="relative w-52 h-16 flex items-center justify-center">
                <Image 
                  src="/TradePass-logo.png" 
                  alt="TradePass Logo" 
                  width={220} 
                  height={70}
                  className="object-contain w-full h-full"
                  priority
                />
              </div>
            </Link>
          )}

          {isDashboard && (
            <span className="bg-blue-950 text-blue-400 border border-blue-800/60 text-xs px-2.5 py-1 rounded-full font-semibold ml-1">
              {planTierDisplay}
            </span>
          )}
        </div>

        {/* Navigation Links for Public Marketing Pages (How It Works & Pricing only) */}
        {!isDashboard && (
          <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-slate-400" aria-label="Main Navigation">
            {isHomePage ? (
              <>
                <a href="#how-it-works" className="hover:text-white transition">How It Works</a>
                <a href="#pricing" className="hover:text-white transition">Pricing</a>
              </>
            ) : (
              <>
                <Link href="/#how-it-works" className="hover:text-white transition">How It Works</Link>
                <Link href="/#pricing" className="hover:text-white transition">Pricing</Link>
              </>
            )}
          </nav>
        )}

        {/* Action Controls & Dynamic User Avatar */}
        <div className="flex items-center space-x-3">
          {isDashboard ? (
            <>
              {/* Dynamic GC Passport Link Control: Locked on Standard, Copyable on Pro/Enterprise */}
              {isStandardTier ? (
                <button 
                  onClick={() => router.push('/signup')}
                  className="hidden sm:flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 text-amber-400 hover:text-amber-300 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-800 transition cursor-pointer"
                  title="Public Passport Link locked on Standard plan"
                >
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Upgrade to Share Passport</span>
                </button>
              ) : (
                <button 
                  onClick={handleCopyPublicLink}
                  className="hidden sm:flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-800 transition cursor-pointer"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <ExternalLink className="w-3.5 h-3.5 text-blue-400" />}
                  <span>{copiedLink ? 'Link Copied!' : 'Copy Public GC Link'}</span>
                </button>
              )}

              {/* Dynamic User Initials Badge */}
              <div className="w-8 h-8 rounded-full bg-blue-600/30 border border-blue-500/50 text-blue-300 font-extrabold text-xs flex items-center justify-center tracking-wider">
                {userInitials}
              </div>

              <Link 
                href="/settings"
                className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-semibold text-xs px-3.5 py-2 rounded-xl flex items-center space-x-2 transition"
              >
                <Settings className="w-4 h-4 text-slate-400" />
                <span>Settings</span>
              </Link>

              <button 
                onClick={handleSignOut}
                disabled={signingOut}
                className="bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/50 text-slate-300 hover:text-rose-300 font-semibold text-xs px-3.5 py-2 rounded-xl flex items-center space-x-2 transition disabled:opacity-50 cursor-pointer"
              >
                <LogOut className="w-4 h-4 text-slate-400" />
                <span>{signingOut ? 'Signing out...' : 'Sign Out'}</span>
              </button>
            </>
          ) : (
            <>
              <Link 
                href="/login"
                className="text-sm font-medium text-slate-300 hover:text-white transition"
              >
                Log In
              </Link>
              <Link 
                href="/signup"
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-lg shadow-blue-600/20 transition"
              >
                Subscribe Now
              </Link>
            </>
          )}
        </div>

      </div>
    </header>
  );
}