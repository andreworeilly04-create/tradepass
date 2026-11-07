'use client';

import React, { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import CheckoutForm from '@/components/CheckoutForm';
import { Loader2, UserCheck } from 'lucide-react';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

export default function SignupPage() {
  const [step, setStep] = useState<'account' | 'payment'>('account');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [createdUid, setCreatedUid] = useState<string>('');
  const [clientSecret, setClientSecret] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAccountCreation = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCred.user.uid;
      setCreatedUid(uid);

      // Create initial Firestore user document
      await setDoc(doc(db, 'users', uid), {
        companyName,
        email,
        planTier: 'Crew Pro',
        maxWorkers: 10,
        subscriptionStatus: 'pending_payment',
        createdAt: new Date(),
      });

      // Fetch clientSecret from API route
      const res = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 6900, email, uid }),
      });
      const data = await res.json();

      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
        setStep('payment');
      } else {
        setError('Failed to initialize payment gateway.');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error creating account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-slate-100 font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full shadow-2xl">
        {step === 'account' ? (
          <>
            <div className="mb-6">
              <h2 className="text-xl font-extrabold text-white">Create TradePass Account</h2>
              <p className="text-xs text-slate-400 mt-1">
                Enter your details to register and proceed to payment.
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-rose-950/80 border border-rose-800 text-rose-300 rounded-xl text-xs font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleAccountCreation} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Company / GC Name
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Apex Construction LLC"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@apex.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
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

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl text-xs transition flex items-center justify-center space-x-2 shadow-lg shadow-blue-600/20 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Setting Up Account...</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-4 h-4" />
                    <span>Continue to Payment</span>
                  </>
                )}
              </button>
            </form>
          </>
        ) : (
          clientSecret && stripePromise && (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'night' } }}>
              <CheckoutForm uid={createdUid} />
            </Elements>
          )
        )}
      </div>
    </div>
  );
}