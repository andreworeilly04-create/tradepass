'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CreditCard, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'billing'>('billing');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [canceling, setCanceling] = useState(false);

  // Auth Guard: Redirect unauthenticated users after session finishes loading
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const handleCancelSubscription = async () => {
    setCanceling(true);
    try {
      // Future Stripe Webhook / Firestore status update logic goes here
      alert('Subscription cancellation request submitted.');
      setShowCancelModal(false);
    } catch (err) {
      console.error('Error canceling subscription:', err);
    } finally {
      setCanceling(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        Loading Settings...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Navigation Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center space-x-3">
            <div className="relative w-10 h-10 flex items-center justify-center">
              <Image 
                src="/TradePass logo.png" 
                alt="TradePass Logo" 
                width={40} 
                height={40}
                className="object-contain"
                priority
              />
            </div>
            <span className="font-extrabold text-lg text-white tracking-tight">
              TradePass
            </span>
          </Link>

          <Link
            href="/dashboard"
            className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 font-semibold text-xs px-3.5 py-2 rounded-xl flex items-center space-x-2 transition"
          >
            <ArrowLeft className="w-4 h-4 text-slate-400" />
            <span>Dashboard</span>
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-6 py-8 w-full flex-grow">
        
        {/* Header Breadcrumb & Title */}
        <div className="mb-8">
          <Link 
            href="/dashboard"
            className="inline-flex items-center space-x-2 text-xs font-semibold text-slate-400 hover:text-white transition mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Command Center</span>
          </Link>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            Account Settings
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Manage your company profile, team size limits, and subscription billing.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex space-x-2 border-b border-slate-800 mb-8">
          <button
            onClick={() => setActiveTab('billing')}
            className={`pb-3 px-4 text-sm font-semibold transition border-b-2 ${
              activeTab === 'billing' 
                ? 'border-blue-500 text-blue-400' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Subscription & Billing
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`pb-3 px-4 text-sm font-semibold transition border-b-2 ${
              activeTab === 'profile' 
                ? 'border-blue-500 text-blue-400' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Company Profile
          </button>
        </div>

        {/* Tab Content: Subscription & Billing */}
        {activeTab === 'billing' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
                <div>
                  <span className="inline-flex items-center space-x-1.5 bg-blue-950 text-blue-400 border border-blue-800/60 text-xs px-3 py-1 rounded-full font-semibold mb-3">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Active Trial</span>
                  </span>
                  <h2 className="text-xl font-bold text-white">Crew Pro Plan</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Includes up to 10 active workers, automated compliance checking, and document vault.
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-white">$49<span className="text-sm font-normal text-slate-400">/mo</span></div>
                  <span className="text-xs text-slate-500">Billed monthly after trial</span>
                </div>
              </div>

              <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-xs text-slate-400">
                  Your 14-day free trial is active. You won&apos;t be charged until your trial ends.
                </p>
                
                <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-3 w-full sm:w-auto">
                  <button 
                    onClick={() => alert("Stripe Checkout integration will launch here!")}
                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-blue-600/20 transition flex items-center justify-center space-x-2"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>Upgrade / Manage Payment</span>
                  </button>

                  <button 
                    onClick={() => setShowCancelModal(true)}
                    className="w-full sm:w-auto bg-slate-950 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/50 text-slate-400 hover:text-rose-300 font-semibold text-xs px-4 py-2.5 rounded-xl transition flex items-center justify-center"
                  >
                    Cancel Subscription
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content: Company Profile */}
        {activeTab === 'profile' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <h2 className="text-lg font-bold text-white pb-4 border-b border-slate-800">
              Company Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Business Name
                </label>
                <input 
                  type="text" 
                  defaultValue="Farina Electric, Inc." 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Account Email
                </label>
                <input 
                  type="email" 
                  defaultValue={user?.email || 'joe@farinaelectric.com'} 
                  disabled
                  className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-500 cursor-not-allowed"
                />
              </div>
            </div>
            <div className="pt-4 flex justify-end">
              <button 
                onClick={() => alert("Profile updated successfully!")}
                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition"
              >
                Save Changes
              </button>
            </div>
          </div>
        )}

        {/* Cancel Subscription Confirmation Modal */}
        {showCancelModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center space-x-2 text-rose-500">
                  <AlertTriangle className="w-5 h-5" />
                  <h3 className="text-lg font-bold text-white">Cancel Subscription?</h3>
                </div>
                <button 
                  onClick={() => setShowCancelModal(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm text-slate-300 mb-6">
                Are you sure you want to cancel your TradePass plan? You will lose automated compliance tracking, worker credential badges, and job-site access clearance.
              </p>

              <div className="flex space-x-3">
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="w-1/2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2.5 rounded-xl text-xs transition"
                >
                  Keep My Plan
                </button>
                <button
                  onClick={handleCancelSubscription}
                  disabled={canceling}
                  className="w-1/2 bg-rose-600 hover:bg-rose-500 text-white font-semibold py-2.5 rounded-xl text-xs transition disabled:opacity-50"
                >
                  {canceling ? 'Canceling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}