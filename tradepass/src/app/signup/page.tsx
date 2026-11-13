'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { CheckCircle2, ArrowRight, ArrowLeft, AlertTriangle } from 'lucide-react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

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

function CheckoutForm({ clientSecret, tierName, onBack }: { clientSecret: string; tierName: string; onBack: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    setErrorMessage('');

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/dashboard`,
      },
    });

    if (error) {
      setErrorMessage(error.message || 'Payment failed.');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Tier Selection</span>
        </button>
      </div>

      <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
        <p className="text-xs text-slate-400 uppercase font-semibold">Selected Tier</p>
        <p className="text-lg font-bold text-white">{tierName}</p>
      </div>

      <PaymentElement />

      {errorMessage && <div className="text-rose-400 text-sm">{errorMessage}</div>}

      <button
        type="submit"
        disabled={!stripe || loading}
        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition disabled:opacity-50 shadow-lg shadow-blue-900/20 cursor-pointer"
      >
        {loading ? 'Processing Payment...' : 'Confirm Plan & Activate'}
      </button>
    </form>
  );
}

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
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleStartCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !companyName || !selectedPriceId) {
      setError('Please fill in all required fields.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      const res = await fetch('/api/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          companyName,
          priceId: selectedPriceId,
          uid,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initialize subscription');

      const selectedTierObj = TIERS.find(t => t.id === selectedPriceId);
      const tierName = selectedTierObj?.name || 'Standard Crew';
      const maxWorkersLimit = selectedPriceId === TIERS[0].id ? 10 : selectedPriceId === TIERS[1].id ? 25 : 999;

      await setDoc(doc(db, 'users', uid), {
        companyName,
        email,
        planTier: tierName,
        maxWorkers: maxWorkersLimit,
        subscriptionId: data.subscriptionId,
        subscriptionStatus: 'active',
        createdAt: serverTimestamp(),
      }, { merge: true });

      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
        return;
      }

      router.push('/dashboard');
    } catch (err: any) {
      console.error('Signup error:', err);
      setError(err.message || 'Failed to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const selectedTierObj = TIERS.find(t => t.id === selectedPriceId);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-12 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto w-full">
        
        {/* Header Branding */}
        <div className="text-center mb-10">
          <Link href="/" className="inline-block mb-4">
            <img
              src="/TradePass-logo.png"
              alt="TradePass Logo"
              className="h-14 sm:h-16 w-auto mx-auto object-contain"
            />
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

        {!clientSecret ? (
          <>
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
              
              <form onSubmit={handleStartCheckout} className="space-y-4">
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
                  <span>{loading ? 'Initializing Payment...' : 'Continue to Payment'}</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>

                <p className="text-center text-xs text-slate-500 mt-4">
                  Already have an account? <Link href="/login" className="text-blue-400 hover:underline">Log in</Link>
                </p>
              </form>
            </div>
          </>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 max-w-xl mx-auto shadow-2xl">
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <CheckoutForm 
                clientSecret={clientSecret} 
                tierName={selectedTierObj?.name || 'Subscription'} 
                onBack={() => setClientSecret('')} 
              />
            </Elements>
          </div>
        )}

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