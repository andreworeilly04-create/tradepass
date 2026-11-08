'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CreditCard, CheckCircle2, AlertTriangle, X, RefreshCw } from 'lucide-react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

interface UserProfile {
  companyName?: string;
  email?: string;
  planTier?: string;
  maxWorkers?: number;
  subscriptionId?: string;
  subscriptionStatus?: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [activeTab, setActiveTab] = useState<'profile' | 'billing'>('billing');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // Auth Guard
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Fetch real-time user profile from Firestore
  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as UserProfile;
        setProfile(data);
        if (data.companyName) {
          setCompanyName(data.companyName);
        }
      }
    });

    return () => unsubscribe();
  }, [user]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        companyName,
      });
      alert('Profile updated successfully!');
    } catch (err) {
      console.error('Error updating profile:', err);
      alert('Failed to update company name.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!user || !profile?.subscriptionId) {
      alert('No active subscription ID found to cancel.');
      return;
    }

    setCanceling(true);
    try {
      const res = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId: profile.subscriptionId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to cancel subscription.');

      await updateDoc(doc(db, 'users', user.uid), {
        subscriptionStatus: 'canceling',
      });

      alert('Your subscription has been scheduled for cancellation at the end of the billing period.');
      setShowCancelModal(false);
    } catch (err: any) {
      console.error('Error canceling subscription:', err);
      alert(err.message || 'An error occurred while canceling.');
    } finally {
      setCanceling(false);
    }
  };

  const handleResumeSubscription = async () => {
    if (!user || !profile?.subscriptionId) {
      alert('No active subscription ID found to resume.');
      return;
    }

    setResuming(true);
    try {
      const res = await fetch('/api/resume-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId: profile.subscriptionId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resume subscription.');

      await updateDoc(doc(db, 'users', user.uid), {
        subscriptionStatus: 'active',
      });

      alert('Your subscription has been successfully reactivated!');
    } catch (err: any) {
      console.error('Error resuming subscription:', err);
      alert(err.message || 'An error occurred while resuming.');
    } finally {
      setResuming(false);
    }
  };

  const getTierPrice = (tier?: string) => {
    switch (tier?.toLowerCase()) {
      case 'standard crew': return '$49';
      case 'crew pro': return '$79';
      case 'multi-crew enterprise': return '$149';
      default: return '$49';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        Loading Settings...
      </div>
    );
  }

  const currentPlan = profile?.planTier || 'Standard Crew';
  const subscriptionStatus = profile?.subscriptionStatus || 'active';
  const isCanceled = subscriptionStatus === 'canceled' || subscriptionStatus === 'canceling';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
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
                ? 'border-emerald-500 text-emerald-400' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Subscription & Billing
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`pb-3 px-4 text-sm font-semibold transition border-b-2 ${
              activeTab === 'profile' 
                ? 'border-emerald-500 text-emerald-400' 
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
                  <span className={`inline-flex items-center space-x-1.5 ${isCanceled ? 'bg-amber-950/80 text-amber-400 border-amber-800/60' : 'bg-emerald-950 text-emerald-400 border-emerald-800/60'} border text-xs px-3 py-1 rounded-full font-semibold mb-3`}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span className="capitalize">{isCanceled ? 'Subscription Canceling' : 'Active Subscription'}</span>
                  </span>
                  <h2 className="text-xl font-bold text-white">{currentPlan}</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Includes up to {profile?.maxWorkers === 999 ? 'Unlimited' : profile?.maxWorkers || 10} active workers and compliance tracking.
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-white">{getTierPrice(currentPlan)}<span className="text-sm font-normal text-slate-400">/mo</span></div>
                  <span className="text-xs text-slate-500">Billed monthly via Stripe</span>
                </div>
              </div>

              <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-xs text-slate-400">
                  {isCanceled
                    ? 'Your subscription is scheduled to end at the conclusion of the billing cycle.'
                    : 'Manage your plan limits or change tier settings.'}
                </p>
                
                <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-3 w-full sm:w-auto">
                  <button 
                    onClick={() => router.push('/signup')}
                    className="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs px-5 py-2.5 rounded-xl transition flex items-center justify-center space-x-2 shadow-lg shadow-emerald-500/20"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>Change Tier</span>
                  </button>

                  {isCanceled ? (
                    <button 
                      onClick={handleResumeSubscription}
                      disabled={resuming}
                      className="w-full sm:w-auto bg-emerald-950 hover:bg-emerald-900 border border-emerald-700/80 text-emerald-400 font-semibold text-xs px-4 py-2.5 rounded-xl transition flex items-center justify-center space-x-1.5 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${resuming ? 'animate-spin' : ''}`} />
                      <span>{resuming ? 'Resuming...' : 'Resume Subscription'}</span>
                    </button>
                  ) : (
                    <button 
                      onClick={() => setShowCancelModal(true)}
                      className="w-full sm:w-auto bg-slate-950 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/50 text-slate-400 hover:text-rose-300 font-semibold text-xs px-4 py-2.5 rounded-xl transition flex items-center justify-center"
                    >
                      Cancel Subscription
                    </button>
                  )}
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
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Account Email
                </label>
                <input 
                  type="email" 
                  value={user?.email || ''} 
                  disabled
                  className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-500 cursor-not-allowed"
                />
              </div>
            </div>
            <div className="pt-4 flex justify-end">
              <button 
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs px-5 py-2.5 rounded-xl transition disabled:opacity-50"
              >
                {savingProfile ? 'Saving...' : 'Save Changes'}
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