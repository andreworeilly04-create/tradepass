'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, ArrowRight, AlertTriangle } from 'lucide-react';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

const TIERS = [
  {
    id: process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID || 'price_standard_fallback',
    name: 'Standard Crew',
    price: '$49',
    description: 'For independent trade contractors',
    features: ['Up to 10 Worker Profiles', 'Automated 30 & 15-Day Email Alerts', 'Internal Credential Tracking']
  },
  {
    id: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID || 'price_pro_fallback',
    name: 'Crew Pro',
    price: '$79',
    description: 'For active trade crews & sub-contractors',
    popular: true,
    features: ['Up to 25 Workers', 'Automated 30, 15, 7, & 1-Day Alerts', 'Itemized Compliance Digest Reports', 'Shareable GC Public Passport Link']
  },
  {
    id: process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID || 'price_enterprise_fallback',
    name: 'Multi-Crew Enterprise',
    price: '$149',
    description: 'For growing commercial contractors',
    features: ['Unlimited Workers & Staff', 'Priority 30, 15, 7, & 1-Day Alerts', 'Multiple Foreman Accounts', 'Custom Company Branding on Passports']
  }
];

function SignupFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultTierParam = searchParams.get('tier');

  const getInitialPriceId = () => {
    if (defaultTierParam === 'pro') return TIERS[1].id;
    if (defaultTierParam === 'enterprise') return TIERS[2].id;
    return TIERS[0].id;
  };

  const [selectedPriceId, setSelectedPriceId] = useState(getInitialPriceId());
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 1. Create Firebase Auth user
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await updateProfile(user, {
        displayName: companyName,
      });

      // 2. Determine tier name & worker limit
      const selectedTierObj = TIERS.find(t => t.id === selectedPriceId);
      const tierName = selectedTierObj?.name || 'Standard Crew';
      const maxWorkersLimit = selectedPriceId === TIERS[0].id ? 10 : selectedPriceId === TIERS[1].id ? 25 : 999;

      // 3. Initialize Firestore user document
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, {
        companyName,
        email,
        planTier: tierName,
        maxWorkers: maxWorkersLimit,
        subscriptionStatus: 'active',
        createdAt: serverTimestamp(),
      });

      // 4. Redirect to dashboard
      router.push('/dashboard');
    } catch (err: any) {
      console.error('Signup error:', err);
      setError(err.message || 'Failed to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-12 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto w-full">
        
        {/* Header Branding */}
        <div className="text-center mb-10">
          <Link href="/" className="inline-block text-2xl font-extrabold text-white tracking-tight mb-2">
            Trade<span className="text-blue-500">Pass</span>
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Secure Your Crew&apos;s Compliance</h1>
          <p className="text-sm text-slate-400 mt-1">Select your plan and create your command center in under 3 minutes.</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-rose-950/50 border border-rose-800 text-rose-300 text-xs rounded-xl flex items-center space-x-2 max-w-xl mx-auto">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
          {TIERS.map((tier) => (
            <div 
              key={tier.id}
              onClick={() => setSelectedPriceId(tier.id)}
              className={`bg-slate-900 rounded-2xl p-6 border-2 cursor-pointer transition flex flex-col justify-between ${
                selectedPriceId === tier.id ? 'border-blue-500 shadow-xl shadow-blue-950/50' : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-base font-bold text-white">{tier.name}</h3>
                  {tier.popular && (
                    <span className="bg-blue-600 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase">
                      Popular
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mb-4">{tier.description}</p>
                <div className="text-2xl font-extrabold text-white mb-4">
                  {tier.price} <span className="text-xs text-slate-400 font-normal">/ month</span>
                </div>
                <ul className="space-y-2.5 text-xs text-slate-300 mb-6">
                  {tier.features.map((feat, i) => (
                    <li key={i} className="flex items-center space-x-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="text-center py-2 rounded-xl text-xs font-semibold border transition">
                {selectedPriceId === tier.id ? (
                  <span className="text-blue-400 font-bold">Selected Plan</span>
                ) : (
                  <span className="text-slate-400">Select Plan</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Signup Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 max-w-xl mx-auto shadow-2xl">
          <h2 className="text-lg font-bold text-white mb-6">Create Your Account</h2>
          
          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Company Name
              </label>
              <input 
                type="text" 
                required
                placeholder="e.g. Apex Electrical Contractors"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Work Email Address
              </label>
              <input 
                type="email" 
                required
                placeholder="manager@apexcontracting.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Password
              </label>
              <input 
                type="password" 
                required
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
              />
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl text-sm transition shadow-lg shadow-blue-600/20 disabled:opacity-50 cursor-pointer flex items-center justify-center space-x-2"
            >
              <span>{loading ? 'Setting up account...' : 'Start 30-Day Compliance Protection'}</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>

            <p className="text-center text-xs text-slate-500 mt-4">
              Already have an account? <Link href="/login" className="text-blue-400 hover:underline">Log in</Link>
            </p>
          </form>
        </div>

      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">Loading signup...</div>}>
      <SignupFormContent />
    </Suspense>
  );
}