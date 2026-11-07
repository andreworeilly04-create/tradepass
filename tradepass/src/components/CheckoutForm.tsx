'use client';

import React, { useState } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { useRouter } from 'next/navigation';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CreditCard, Lock, Loader2 } from 'lucide-react';

interface CheckoutFormProps {
  uid: string;
}

export default function CheckoutForm({ uid }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();

  const [message, setMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) return;

    setIsProcessing(true);
    setMessage(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/dashboard`,
      },
      redirect: 'if_required',
    });

    if (error) {
      setMessage(error.message || 'An unexpected error occurred during payment.');
      setIsProcessing(false);
    } else if (paymentIntent && paymentIntent.status === 'succeeded') {
      // Instantly mark user's subscription as active in Firestore
      await setDoc(doc(db, 'users', uid), {
        planTier: 'Crew Pro',
        subscriptionStatus: 'active',
      }, { merge: true });

      setMessage('Payment successful! Redirecting to dashboard...');
      router.push('/dashboard');
    } else {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl max-w-md w-full">
      <div className="flex items-center space-x-3 pb-4 border-b border-slate-800">
        <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
          <CreditCard className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-white">Payment Details</h2>
          <p className="text-xs text-slate-400">Enter your card details to activate Crew Pro</p>
        </div>
      </div>

      {/* Embedded Stripe Payment Element */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
        <PaymentElement />
      </div>

      {message && (
        <div className={`p-3 rounded-xl text-xs font-semibold ${message.includes('successful') ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'}`}>
          {message}
        </div>
      )}

      <button
        type="submit"
        disabled={isProcessing || !stripe || !elements}
        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl text-xs transition flex items-center justify-center space-x-2 shadow-lg shadow-blue-600/20 disabled:opacity-50"
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Processing Payment...</span>
          </>
        ) : (
          <>
            <Lock className="w-4 h-4" />
            <span>Pay & Activate Subscription</span>
          </>
        )}
      </button>

      <p className="text-[11px] text-slate-500 text-center flex items-center justify-center space-x-1">
        <Lock className="w-3 h-3" />
        <span>Encrypted 256-bit SSL connection</span>
      </p>
    </form>
  );
}