'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Check, ArrowLeft, CheckCircle2 } from 'lucide-react';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

const TIERS = [
  {
    id: process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID,
    name: 'Standard Crew',
    price: '$49',
    workers: 'Up to 10 workers',
    features: [
      'Up to 10 Worker Profiles',
      'Automated 30 & 15-Day Email Alerts',
      'Internal Credential & Roster Tracking',
      'Secure Cloud Document Storage'
    ]
  },
  {
    id: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID,
    name: 'Crew Pro',
    price: '$79',
    workers: 'Up to 25 workers',
    popular: true,
    features: [
      'Up to 25 Workers',
      'Automated 30, 15, 7, & 1-Day Email Alerts',
      'Itemized Compliance Digest Reports',
      'Shareable GC Public Passport Link'
    ]
  },
  {
    id: process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID,
    name: 'Multi-Crew Enterprise',
    price: '$149',
    workers: 'Unlimited workers',
    features: [
      'Unlimited Workers & Staff',
      'Priority 30, 15, 7, & 1-Day Urgent Alerts',
      'Multiple Foreman Accounts',
      'Custom Company Branding on Passports'
    ]
  },
];

interface UserProfile {
  companyName?: string;
  email?: string;
  planTier?: string;
  subscriptionId?: string;
}

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
          className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-400 hover:text-white transition"
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
        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition disabled:opacity-50 shadow-lg shadow-blue-900/20"
      >
        {loading ? 'Processing Payment...' : 'Confirm Plan & Activate'}
      </button>
    </form>
  );
}

function SignupFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tierParam = searchParams.get('tier');

  const getInitialPriceId = () => {
    if (tierParam === 'pro') return TIERS[1].id;
    if (tierParam === 'enterprise') return TIERS[2].id;
    return TIERS[0].id;
  };

  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedPriceId, setSelectedPriceId] = useState(getInitialPriceId());
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isLoggedInUser, setIsLoggedInUser] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (currentUser) {
        setIsLoggedInUser(true);
        setEmail(currentUser.email || '');

        const userDocRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const data = userSnap.data() as UserProfile;
          setProfile(data);
          if (data.companyName) {
            setCompanyName(data.companyName);
          }
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const handleStartCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || (!isLoggedInUser && !password) || !companyName || !selectedPriceId) {
      setError('Please fill in all required fields.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let uid = auth.currentUser?.uid;

      if (!uid) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        uid = userCredential.user.uid;
      }

      const res = await fetch('/api/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          companyName,
          priceId: selectedPriceId,
          uid,
          subscriptionId: profile?.subscriptionId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initialize subscription');

      // Prevent bypass if clientSecret is missing from the backend response
      if (!data.clientSecret) {
        throw new Error('Failed to generate payment session. Please try again.');
      }

      const maxWorkersLimit = selectedPriceId === TIERS[0].id ? 10 : selectedPriceId === TIERS[1].id ? 25 : 999;
      const tierNameObj = TIERS.find(t => t.id === selectedPriceId)?.name || 'Standard Crew';

      // Save as 'incomplete' until payment confirmation succeeds
      await setDoc(doc(db, 'users', uid), {
        companyName,
        email,
        planTier: tierNameObj,
        maxWorkers: maxWorkersLimit,
        subscriptionId: data.subscriptionId,
        subscriptionStatus: 'incomplete',
        createdAt: serverTimestamp(),
      }, { merge: true });

      // Trigger the Stripe Payment Element view securely
      setClientSecret(data.clientSecret);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectedTierObj = TIERS.find(t => t.id === selectedPriceId);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-12 px-6">
      <div className="max-w-lg w-full mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        
        {!clientSecret ? (
          <>
            <div className="mb-6">
              <Link 
                href={isLoggedInUser ? "/dashboard" : "/"}
                className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-400 hover:text-white transition mb-4"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{isLoggedInUser ? 'Back to Dashboard' : 'Back to Home'}</span>
              </Link>
              <h1 className="text-2xl font-extrabold text-white mb-2">
                {isLoggedInUser ? 'Change Subscription Tier' : 'Secure Your Job-Site'}
              </h1>
              <p className="text-sm text-slate-400">
                {isLoggedInUser ? 'Select your new plan tier below. Card re-verification is required.' : 'Choose your crew tier and create your TradePass account.'}
              </p>
            </div>

            {error && <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-xl">{error}</div>}

            <form onSubmit={handleStartCheckout} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Company Name</label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Vance Electric LLC"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Owner Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  disabled={isLoggedInUser}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vance@electric.com"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 ${isLoggedInUser ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
              </div>

              {!isLoggedInUser && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              <div className="space-y-3 pt-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">Select Subscription Tier</label>
                {TIERS.map((tier) => (
                  <div
                    key={tier.id}
                    onClick={() => setSelectedPriceId(tier.id)}
                    className={`p-4 rounded-xl border cursor-pointer transition ${
                      selectedPriceId === tier.id ? 'border-blue-500 bg-blue-950/40' : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-bold text-white text-sm">{tier.name}</span>
                        <span className="text-blue-400 font-extrabold text-sm ml-2">{tier.price}<span className="text-slate-400 text-xs font-normal">/mo</span></span>
                      </div>
                      {selectedPriceId === tier.id && <Check className="w-5 h-5 text-blue-400" />}
                    </div>
                    
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-2 border-t border-slate-800/60 text-xs text-slate-300">
                      {tier.features.map((feature, idx) => (
                        <li key={idx} className="flex items-center space-x-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl text-sm transition disabled:opacity-50 mt-4 shadow-lg shadow-blue-900/20"
              >
                {loading ? 'Processing...' : isLoggedInUser ? 'Proceed to Payment Verification' : 'Continue to Payment'}
              </button>
            </form>
          </>
        ) : (
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <CheckoutForm 
              clientSecret={clientSecret} 
              tierName={selectedTierObj?.name || 'Subscription'} 
              onBack={() => setClientSecret('')} 
            />
          </Elements>
        )}
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">Loading checkout...</div>}>
      <SignupFormContent />
    </Suspense>
  );
}