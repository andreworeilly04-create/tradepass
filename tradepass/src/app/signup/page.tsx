'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Check, ArrowLeft, CheckCircle2 } from 'lucide-react';
import CheckoutForm from '@/components/CheckoutForm';

const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePublishableKey
  ? loadStripe(stripePublishableKey)
  : null;

const TIERS = [
  {
    id: process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID || '',
    name: 'Standard Crew',
    price: '$49',
    workers: 'Up to 10 workers',
    features: [
      'Up to 10 Worker Profiles',
      'Automated 30 & 15-Day Email Alerts',
      'Internal Credential & Roster Tracking',
      'Secure Cloud Document Storage',
    ],
  },
  {
    id: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID || '',
    name: 'Crew Pro',
    price: '$79',
    workers: 'Up to 25 workers',
    popular: true,
    features: [
      'Up to 25 Workers',
      'Automated 30, 15, 7 Email Alerts',
      'Itemized Compliance Digest Reports',
      'Shareable GC Public Passport Link',
    ],
  },
  {
    id: process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID || '',
    name: 'Multi-Crew Enterprise',
    price: '$149',
    workers: 'Unlimited workers',
    features: [
      'Unlimited Workers & Staff',
      'Priority 30, 15, 7, & 1-Day Urgent Alerts',
      'Multiple Foreman Accounts',
      'Custom Company Branding on Passports',
    ],
  },
];

interface UserProfile {
  companyName?: string;
  email?: string;
  planTier?: string;
  subscriptionId?: string;
}

function isValidIntentClientSecret(secret: unknown): secret is string {
  return (
    typeof secret === 'string' &&
    (secret.startsWith('pi_') || secret.startsWith('seti_'))
  );
}

function getPriceIdForPlanTier(planTier?: string): string | null {
  if (!planTier) return null;
  const normalized = planTier.toLowerCase();

  if (
    (normalized.includes('enterprise') || normalized.includes('multi')) &&
    TIERS[2].id
  ) {
    return TIERS[2].id;
  }

  if (normalized.includes('pro') && TIERS[1].id) {
    return TIERS[1].id;
  }

  if (normalized.includes('standard') && TIERS[0].id) {
    return TIERS[0].id;
  }

  return null;
}

function SignupFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tierParam = searchParams.get('tier');

  const getInitialPriceId = () => {
    if (tierParam === 'pro' && TIERS[1].id) return TIERS[1].id;
    if (tierParam === 'enterprise' && TIERS[2].id) return TIERS[2].id;
    return TIERS[0].id;
  };

  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedPriceId, setSelectedPriceId] = useState(getInitialPriceId());
  const [clientSecret, setClientSecret] = useState('');
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [isLoggedInUser, setIsLoggedInUser] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [activeSubscriptionId, setActiveSubscriptionId] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (currentUser) {
        setIsLoggedInUser(true);
        setEmail(currentUser.email || '');
        setUserId(currentUser.uid);
        setProfileLoading(true);

        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userDocRef);

          if (userSnap.exists()) {
            const data = userSnap.data() as UserProfile;
            setProfile(data);
            setActiveSubscriptionId(data.subscriptionId);

            if (data.companyName) {
              setCompanyName(data.companyName);
            }

            const currentTierPriceId = getPriceIdForPlanTier(data.planTier);
            if (!tierParam && currentTierPriceId) {
              setSelectedPriceId(currentTierPriceId);
            }
          } else {
            setProfile({});
          }
        } catch (err) {
          console.error('Failed to load user profile:', err);
          setProfile({});
        } finally {
          setProfileLoading(false);
        }
      } else {
        setIsLoggedInUser(false);
        setProfile(null);
        setActiveSubscriptionId(undefined);
        setProfileLoading(false);
      }
    });

    return () => unsubscribe();
  }, [tierParam]);

  const handleBackFromCheckout = () => {
    setClientSecret('');
    setError('');
    setInfoMessage('');
    const currentTierPriceId = getPriceIdForPlanTier(profile?.planTier);
    if (currentTierPriceId) {
      setSelectedPriceId(currentTierPriceId);
    }
  };

  const handleStartCheckout = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripePromise) {
      setError('Stripe publishable key is not configured.');
      return;
    }

    if (isLoggedInUser && profileLoading) {
      setError(
        'Loading your account details. Please wait a second and try again.'
      );
      return;
    }

    if (
      !email ||
      (!isLoggedInUser && !password) ||
      !companyName ||
      !selectedPriceId
    ) {
      setError('Please fill in all required fields and select a plan tier.');
      return;
    }

    setLoading(true);
    setError('');
    setInfoMessage('');

    try {
      let uid = auth.currentUser?.uid;

      if (!uid) {
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        uid = userCredential.user.uid;
      }

      setUserId(uid);

      const res = await fetch('/api/create-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          companyName,
          priceId: selectedPriceId,
          uid,
          subscriptionId: activeSubscriptionId || profile?.subscriptionId,
        }),
      });

      const data = await res.json();

      if (data.subscriptionId) {
        setActiveSubscriptionId(data.subscriptionId);
      }

      if (!res.ok) {
        throw new Error(
          data.error || 'Failed to initialize subscription.'
        );
      }

      if (isValidIntentClientSecret(data.clientSecret)) {
        setClientSecret(data.clientSecret);
        return;
      }

      if (data.isNoChange) {
        setInfoMessage(
          'You are already subscribed to this tier. Select a different plan to switch tiers, or return to your dashboard.'
        );
        return;
      }

      if (data.isDowngrade || data.isNoPaymentRequired) {
        router.push('/dashboard');
        return;
      }

      setError(
        data.error ||
          'Payment confirmation could not be generated. Please try again.'
      );
    } catch (err: any) {
      console.error('Checkout initialization error:', err);
      setError(err.message || 'Unable to start checkout.');
    } finally {
      setLoading(false);
    }
  };

  const selectedTierObj = TIERS.find(
    (tier) => tier.id && tier.id === selectedPriceId
  );

  const getMaxWorkersForTier = (name?: string) => {
    if (!name) return 10;

    if (name.toLowerCase().includes('pro')) return 25;

    if (
      name.toLowerCase().includes('enterprise') ||
      name.toLowerCase().includes('multi')
    ) {
      return 999;
    }

    return 10;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-12 px-6">
      <div className="max-w-lg w-full mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        {!clientSecret ? (
          <>
            <div className="mb-6">
              <Link
                href={isLoggedInUser ? '/dashboard' : '/'}
                className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-400 hover:text-white transition mb-4"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>
                  {isLoggedInUser ? 'Back to Dashboard' : 'Back to Home'}
                </span>
              </Link>

              <h1 className="text-2xl font-extrabold text-white mb-2">
                {isLoggedInUser
                  ? 'Change Subscription Tier'
                  : 'Secure Your Job-Site'}
              </h1>

              <p className="text-sm text-slate-400">
                {isLoggedInUser
                  ? 'Select your new plan tier below. Card re-verification is only required if a balance is due.'
                  : 'Choose your crew tier and create your TradePass account.'}
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-xl">
                {error}
              </div>
            )}

            {infoMessage && (
              <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs rounded-xl">
                {infoMessage}
              </div>
            )}

            <form onSubmit={handleStartCheckout} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Company Name
                </label>

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
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Owner Email
                </label>

                <input
                  type="email"
                  required
                  value={email}
                  disabled={isLoggedInUser}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vance@electric.com"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 ${
                    isLoggedInUser ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                />
              </div>

              {!isLoggedInUser && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Password
                  </label>

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
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Select Subscription Tier
                </label>

                {TIERS.map((tier) => {
                  const isSelectable = Boolean(tier.id);
                  const isSelected = isSelectable && selectedPriceId === tier.id;

                  return (
                    <div
                      key={tier.id || tier.name}
                      onClick={() => {
                        if (isSelectable) {
                          setSelectedPriceId(tier.id);
                          setInfoMessage('');
                          setError('');
                        }
                      }}
                      className={`p-4 rounded-xl border transition ${
                        !isSelectable
                          ? 'border-slate-800 bg-slate-950/50 opacity-50 cursor-not-allowed'
                          : isSelected
                            ? 'border-blue-500 bg-blue-950/40 cursor-pointer'
                            : 'border-slate-800 bg-slate-950 hover:border-slate-700 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-bold text-white text-sm">
                            {tier.name}
                          </span>

                          <span className="text-blue-400 font-extrabold text-sm ml-2">
                            {tier.price}
                            <span className="text-slate-400 text-xs font-normal">
                              /mo
                            </span>
                          </span>
                        </div>

                        {isSelected && (
                          <Check className="w-5 h-5 text-blue-400" />
                        )}
                      </div>

                      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-2 border-t border-slate-800/60 text-xs text-slate-300">
                        {tier.features.map((feature, idx) => (
                          <li
                            key={idx}
                            className="flex items-center space-x-1.5"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <button
                type="submit"
                disabled={loading || (isLoggedInUser && profileLoading)}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl text-sm transition disabled:opacity-50 mt-4 shadow-lg shadow-blue-900/20"
              >
                {loading
                  ? 'Processing...'
                  : isLoggedInUser
                    ? 'Update Subscription Tier'
                    : 'Continue to Payment'}
              </button>
            </form>
          </>
        ) : (
          <div>
            <button
              type="button"
              onClick={handleBackFromCheckout}
              className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-400 hover:text-white transition mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Change Plan Tier</span>
            </button>

            <Elements
              key={clientSecret}
              stripe={stripePromise}
              options={{ clientSecret }}
            >
              <CheckoutForm
                uid={userId}
                clientSecret={clientSecret}
                selectedTier={selectedTierObj?.name || 'Subscription'}
                maxWorkers={getMaxWorkersForTier(selectedTierObj?.name)}
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
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
          Loading checkout...
        </div>
      }
    >
      <SignupFormContent />
    </Suspense>
  );
}