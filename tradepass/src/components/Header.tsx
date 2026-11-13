'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { ExternalLink, Settings, LogOut, Lock, Check, Menu, X } from 'lucide-react';
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const isDashboard = pathname.startsWith('/dashboard') || pathname.startsWith('/settings');
  const isHomePage = pathname === '/';

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

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
      setMobileMenuOpen(false);
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
    <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-between gap-2">
        
        {/* Brand Logo & Dynamic Plan Badge */}
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
          {isHomePage ? (
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex items-center bg-transparent border-0 p-0 cursor-pointer shrink-0"
              aria-label="Scroll to top"
            >
              <div className="relative w-36 sm:w-52 h-12 sm:h-16 flex items-center justify-center">
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
            <Link href={user ? "/dashboard" : "/"} className="flex items-center shrink-0">
              <div className="relative w-36 sm:w-52 h-12 sm:h-16 flex items-center justify-center">
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
            <span className="hidden sm:inline-block bg-blue-950 text-blue-400 border border-blue-800/60 text-xs px-2.5 py-1 rounded-full font-semibold truncate">
              {planTierDisplay}
            </span>
          )}
        </div>

        {/* Desktop Navigation Links for Public Marketing Pages */}
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

        {/* Desktop Action Controls & Dynamic User Avatar */}
        <div className="hidden md:flex items-center space-x-3">
          {isDashboard ? (
            <>
              {isStandardTier ? (
                <button 
                  onClick={() => router.push('/signup')}
                  className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 text-amber-400 hover:text-amber-300 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-800 transition cursor-pointer"
                  title="Public Passport Link locked on Standard plan"
                >
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Upgrade to Share Passport</span>
                </button>
              ) : (
                <button 
                  onClick={handleCopyPublicLink}
                  className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-800 transition cursor-pointer"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <ExternalLink className="w-3.5 h-3.5 text-blue-400" />}
                  <span>{copiedLink ? 'Link Copied!' : 'Copy Public GC Link'}</span>
                </button>
              )}

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
                className="text-sm font-medium text-slate-300 hover:text-white transition px-2 py-1"
              >
                Log In
              </Link>
              <Link 
                href="/signup"
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-lg shadow-blue-600/20 transition whitespace-nowrap"
              >
                Subscribe Now
              </Link>
            </>
          )}
        </div>

        {/* Mobile Hamburger Trigger & Avatar */}
        <div className="flex md:hidden items-center space-x-2">
          {isDashboard && (
            <div className="w-8 h-8 rounded-full bg-blue-600/30 border border-blue-500/50 text-blue-300 font-extrabold text-xs flex items-center justify-center tracking-wider">
              {userInitials}
            </div>
          )}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-900 border border-transparent hover:border-slate-800 transition cursor-pointer"
            aria-label="Toggle Menu"
            aria-expanded={mobileMenuOpen}
          >
            <div className="relative w-6 h-6 flex items-center justify-center">
              <Menu
                className={`w-6 h-6 absolute transition-all duration-300 ease-out ${
                  mobileMenuOpen ? 'opacity-0 rotate-90 scale-75' : 'opacity-100 rotate-0 scale-100'
                }`}
              />
              <X
                className={`w-6 h-6 absolute transition-all duration-300 ease-out ${
                  mobileMenuOpen ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-75'
                }`}
              />
            </div>
          </button>
        </div>

      </div>

      {/* Smooth Animated Mobile Dropdown Drawer */}
      <div
        aria-hidden={!mobileMenuOpen}
        className={`md:hidden grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
          mobileMenuOpen
            ? 'grid-rows-[1fr] opacity-100 border-t border-slate-800'
            : 'grid-rows-[0fr] opacity-0 border-t border-transparent pointer-events-none'
        }`}
      >
        <div className="overflow-hidden">
          <div className="bg-slate-950 px-4 pt-3 pb-6 space-y-4">
            {isDashboard ? (
              <>
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                  <span className="text-xs text-slate-400">Current Plan</span>
                  <span className="bg-blue-950 text-blue-400 border border-blue-800/60 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                    {planTierDisplay}
                  </span>
                </div>

                {isStandardTier ? (
                  <button 
                    onClick={() => {
                      setMobileMenuOpen(false);
                      router.push('/signup');
                    }}
                    tabIndex={mobileMenuOpen ? 0 : -1}
                    className="w-full flex items-center justify-center space-x-2 bg-slate-900 hover:bg-slate-800 text-amber-400 text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-800 transition cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Upgrade to Share Passport</span>
                  </button>
                ) : (
                  <button 
                    onClick={handleCopyPublicLink}
                    tabIndex={mobileMenuOpen ? 0 : -1}
                    className="w-full flex items-center justify-center space-x-2 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-800 transition cursor-pointer"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <ExternalLink className="w-3.5 h-3.5 text-blue-400" />}
                    <span>{copiedLink ? 'Link Copied!' : 'Copy Public GC Link'}</span>
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <Link 
                    href="/settings"
                    onClick={() => setMobileMenuOpen(false)}
                    tabIndex={mobileMenuOpen ? 0 : -1}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 font-semibold text-xs py-2.5 rounded-xl flex items-center justify-center space-x-2 transition"
                  >
                    <Settings className="w-4 h-4 text-slate-400" />
                    <span>Settings</span>
                  </Link>

                  <button 
                    onClick={handleSignOut}
                    disabled={signingOut}
                    tabIndex={mobileMenuOpen ? 0 : -1}
                    className="bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/50 text-slate-200 hover:text-rose-300 font-semibold text-xs py-2.5 rounded-xl flex items-center justify-center space-x-2 transition disabled:opacity-50 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 text-slate-400" />
                    <span>{signingOut ? 'Signing out...' : 'Sign Out'}</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <nav className="flex flex-col space-y-2 text-sm font-medium text-slate-300" aria-label="Mobile Navigation">
                  {isHomePage ? (
                    <>
                      <a 
                        href="#how-it-works" 
                        onClick={() => setMobileMenuOpen(false)}
                        tabIndex={mobileMenuOpen ? 0 : -1}
                        className="py-2 px-2 rounded-lg hover:bg-slate-900 hover:text-white transition"
                      >
                        How It Works
                      </a>
                      <a 
                        href="#pricing" 
                        onClick={() => setMobileMenuOpen(false)}
                        tabIndex={mobileMenuOpen ? 0 : -1}
                        className="py-2 px-2 rounded-lg hover:bg-slate-900 hover:text-white transition"
                      >
                        Pricing
                      </a>
                    </>
                  ) : (
                    <>
                      <Link 
                        href="/#how-it-works" 
                        onClick={() => setMobileMenuOpen(false)}
                        tabIndex={mobileMenuOpen ? 0 : -1}
                        className="py-2 px-2 rounded-lg hover:bg-slate-900 hover:text-white transition"
                      >
                        How It Works
                      </Link>
                      <Link 
                        href="/#pricing" 
                        onClick={() => setMobileMenuOpen(false)}
                        tabIndex={mobileMenuOpen ? 0 : -1}
                        className="py-2 px-2 rounded-lg hover:bg-slate-900 hover:text-white transition"
                      >
                        Pricing
                      </Link>
                    </>
                  )}
                </nav>

                <div className="pt-3 border-t border-slate-800 flex flex-col space-y-2.5">
                  <Link 
                    href="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    tabIndex={mobileMenuOpen ? 0 : -1}
                    className="w-full text-center py-2.5 text-sm font-semibold text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl transition"
                  >
                    Log In
                  </Link>
                  <Link 
                    href="/signup"
                    onClick={() => setMobileMenuOpen(false)}
                    tabIndex={mobileMenuOpen ? 0 : -1}
                    className="w-full text-center py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-lg shadow-blue-600/20 transition"
                  >
                    Subscribe Now
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}