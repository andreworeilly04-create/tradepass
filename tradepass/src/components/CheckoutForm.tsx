
'use client';

import React, { useState } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { useRouter } from 'next/navigation';
import { CreditCard, Lock, Loader2 } from 'lucide-react';

interface CheckoutFormProps {
  uid: string;
  clientSecret: string;
  selectedTier?: string;
  maxWorkers?: number;
}

export default function CheckoutForm({
  uid,
  clientSecret,
  selectedTier = 'Crew Pro',
  maxWorkers = 25,
}: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();

  const [message, setMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements || isProcessing) return;

    setIsProcessing(true);
    setMessage(null);

    try {
      // Validate the Stripe Payment Element.
      const { error: submitError } = await elements.submit();

      if (submitError) {
        console.error('🔍 Elements Submit Error:', submitError);
        setMessage(
          submitError.message || 'Please check your payment details.'
        );
        return;
      }

      // Stripe SetupIntent client secrets start with seti_.
      // PaymentIntent client secrets start with pi_.
      const isSetupIntent = clientSecret.startsWith('seti_');
      console.log('🔍 Intent Type:', isSetupIntent ? 'SetupIntent' : 'PaymentIntent');
      console.log('🔍 Client Secret:', clientSecret);

      let result: any;

      if (isSetupIntent) {
        // Confirm card setup when Stripe requires a SetupIntent.
        result = await stripe.confirmSetup({
          elements,
          clientSecret,
          confirmParams: {
            return_url: `${window.location.origin}/dashboard`,
          },
          redirect: 'if_required',
        });
      } else {
        // Confirm payment when Stripe requires a PaymentIntent.
        result = await stripe.confirmPayment({
          elements,
          clientSecret,
          confirmParams: {
            return_url: `${window.location.origin}/dashboard`,
          },
          redirect: 'if_required',
        });
      }

      console.log('🔍 Stripe Confirmation Raw Result:', result);

      // Handle Stripe errors.
      if (result.error) {
        console.error('🔍 Stripe Confirmation Error Object:', result.error);
        setMessage(
          result.error.message ||
          'An unexpected error occurred during payment.'
        );
        return;
      }

      // Verify the returned Stripe intent status.
      const intentStatus = isSetupIntent
        ? result.setupIntent?.status
        : result.paymentIntent?.status;

      console.log('🔍 Confirmed Intent Status:', intentStatus);

      if (intentStatus !== 'succeeded') {
        setMessage(
          `Your payment has not completed yet. Current status: ${
            intentStatus || 'unknown'
          }. Please try again or contact support.`
        );
        return;
      }

      setMessage(
        'Payment confirmed! Your subscription is being updated. Redirecting...'
      );

      router.push('/dashboard');

    } catch (error: any) {
      console.error('🔍 Checkout Exception Error:', error);

      setMessage(
        error.message || 'Unable to process payment. Please try again.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl max-w-md w-full"
    >
      <div className="flex items-center space-x-3 pb-4 border-b border-slate-800">
        <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
          <CreditCard className="w-5 h-5" />
        </div>

        <div>
          <h2 className="text-lg font-extrabold text-white">
            Payment Details
          </h2>

          <p className="text-xs text-slate-400">
            Enter your card details to activate {selectedTier}
          </p>
        </div>
      </div>

      {/* Embedded Stripe Payment Element */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 min-h-[150px]">
        <PaymentElement />
      </div>

      {message && (
        <div
          className={`p-3 rounded-xl text-xs font-semibold ${
            message.includes('confirmed!')
              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
              : 'bg-rose-950 text-rose-400 border border-rose-800'
          }`}
        >
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