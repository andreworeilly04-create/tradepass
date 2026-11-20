'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Building, 
  Mail, 
  CheckCircle2, 
  AlertTriangle, 
  Save, 
  ArrowLeft,
  RefreshCw,
  XCircle,
  X
} from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

interface UserProfile {
  companyName?: string;
  planTier?: string;
  maxWorkers?: number;
  subscriptionStatus?: string;
  cancelAtPeriodEnd?: boolean;
  companyLogoUrl?: string;
  brandColor?: string;
  foremanEmails?: string[];
  subscriptionId?: string;
}

interface NotificationState {
  type: 'success' | 'error';
  message: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);
  const [companySaveSuccess, setCompanySaveSuccess] = useState(false);
  const [updatingSubscription, setUpdatingSubscription] = useState(false);
  
  const [notification, setNotification] = useState<NotificationState | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as UserProfile;
        setProfile(data);
        if (data.companyName) setCompanyName(data.companyName);
      }
    });

    return () => unsubscribe();
  }, [user]);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !companyName.trim()) return;

    try {
      setSavingCompany(true);
      
      // Routed securely through backend API to bypass client permission errors
      const response = await fetch('/api/update-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          companyName: companyName.trim()
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update company name');
      }

      setCompanySaveSuccess(true);
      setTimeout(() => setCompanySaveSuccess(false), 3000);
    } catch (err: any) {
      console.error("Error saving company name:", err);
      showNotification('error', err.message || 'Failed to update company name. Please try again.');
    } finally {
      setSavingCompany(false);
    }
  };

  const handleToggleSubscription = async (targetAction: 'cancel' | 'resume') => {
    if (!user) return;

    try {
      setUpdatingSubscription(true);

      if (!profile?.subscriptionId) {
        throw new Error('No active subscription ID found on your profile.');
      }

      const endpoint = targetAction === 'cancel' ? '/api/cancel-subscription' : '/api/resume-subscription';
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId: profile.subscriptionId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update subscription on Stripe');
      }

      showNotification(
        'success', 
        targetAction === 'cancel' 
          ? 'Subscription updated to cancel at the end of your billing cycle.' 
          : 'Subscription successfully resumed and set to auto-renew.'
      );

    } catch (err: any) {
      console.error(`Error trying to ${targetAction} subscription:`, err);
      showNotification('error', err.message || `Could not ${targetAction} subscription. Please try again.`);
    } finally {
      setUpdatingSubscription(false);
    }
  };

  const rawTier = (profile?.planTier || '').toLowerCase();
  const isEnterpriseTier = rawTier.includes('enterprise') || rawTier.includes('multi-crew');
  const isStandardTier = rawTier.includes('standard') && !isEnterpriseTier;

  const currentPlan = isEnterpriseTier 
    ? 'Multi-Crew Enterprise ($149/mo)' 
    : isStandardTier 
    ? 'Standard Crew ($49/mo)' 
    : 'Crew Pro ($79/mo)';

  const subscriptionStatus = profile?.subscriptionStatus || 'active';
  const cancelAtPeriodEnd = profile?.cancelAtPeriodEnd || false;

  const isPaymentPending = subscriptionStatus === 'past_due' || subscriptionStatus === 'incomplete';
  const isExpired = subscriptionStatus === 'expired' || subscriptionStatus === 'canceled';

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-sans">
        Loading Account Settings...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <main className="max-w-4xl mx-auto px-6 py-8 w-full flex-grow">
        
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button 
              onClick={() => router.push('/dashboard')}
              className="text-xs text-slate-400 hover:text-white flex items-center space-x-1.5 transition mb-2 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Command Center</span>
            </button>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Account & Subscription Settings</h1>
            <p className="text-sm text-slate-400 mt-0.5">Manage your company profile, billing subscription, and tier features.</p>
          </div>
        </div>

        {notification && (
          <div 
            className={`mb-6 p-4 rounded-2xl border flex items-center justify-between shadow-xl text-sm transition ${
              notification.type === 'error' 
                ? 'bg-rose-950/60 border-rose-800 text-rose-300' 
                : 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
            }`}
          >
            <div className="flex items-center space-x-3">
              {notification.type === 'error' ? (
                <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              )}
              <span>{notification.message}</span>
            </div>
            <button 
              onClick={() => setNotification(null)}
              className="text-slate-400 hover:text-white transition p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
            <div>
              <span 
                className={`inline-flex items-center space-x-1.5 border text-xs px-3 py-1 rounded-full font-semibold mb-3 ${
                  isExpired
                    ? 'bg-rose-950/80 text-rose-400 border-rose-800/60'
                    : isPaymentPending
                    ? 'bg-amber-950/80 text-amber-400 border-amber-800/60'
                    : cancelAtPeriodEnd
                    ? 'bg-amber-950/80 text-amber-400 border-amber-800/60'
                    : 'bg-blue-950 text-blue-400 border-blue-800/60'
                }`}
              >
                {isExpired ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                ) : isPaymentPending || cancelAtPeriodEnd ? (
                  <XCircle className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span>
                  {isExpired 
                    ? 'Subscription Inactive' 
                    : isPaymentPending
                    ? 'Checkout / Payment Pending'
                    : cancelAtPeriodEnd 
                    ? 'Subscription Canceling (Active until end of period)' 
                    : 'Active Subscription'}
                </span>
              </span>

              <h2 className="text-xl font-bold text-white">
                {isExpired ? 'No Active Plan' : currentPlan}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {isExpired 
                  ? 'Your subscription is inactive. Select a plan to activate or renew access.' 
                  : isPaymentPending
                  ? 'Your previous checkout was not completed. Continue checkout or choose a plan tier to finish.'
                  : cancelAtPeriodEnd
                  ? 'Your subscription will not auto-renew at the end of the current billing cycle.'
                  : `Covers up to ${profile?.maxWorkers === 999 ? 'Unlimited' : profile?.maxWorkers || 10} active workers.`}
              </p>
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              {cancelAtPeriodEnd && !isExpired ? (
                <button
                  onClick={() => handleToggleSubscription('resume')}
                  disabled={updatingSubscription}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition shadow-lg shadow-emerald-600/20 flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${updatingSubscription ? 'animate-spin' : ''}`} />
                  <span>{updatingSubscription ? 'Resuming...' : 'Resume Subscription'}</span>
                </button>
              ) : !isExpired && !isPaymentPending ? (
                <button
                  onClick={() => handleToggleSubscription('cancel')}
                  disabled={updatingSubscription}
                  className="bg-slate-800 hover:bg-rose-950/50 hover:text-rose-400 border border-slate-700 hover:border-rose-800/80 text-slate-300 font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5 text-rose-400" />
                  <span>{updatingSubscription ? 'Canceling...' : 'Cancel Subscription'}</span>
                </button>
              ) : (
                <button 
                  onClick={() => router.push('/signup')}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition shadow-lg shadow-emerald-600/20 cursor-pointer"
                >
                  {isPaymentPending ? 'Complete Checkout' : 'Renew Plan'}
                </button>
              )}

              <button 
                onClick={() => router.push('/signup')}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition shadow-lg shadow-blue-600/20 cursor-pointer"
              >
                Change Tier
              </button>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center space-x-2">
            <Building className="w-5 h-5 text-blue-400" />
            <span>Company Profile</span>
          </h3>

          <form onSubmit={handleSaveCompany} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Account Owner Email
              </label>
              <div className="flex items-center space-x-2 bg-slate-950 border border-slate-800/80 rounded-xl px-4 py-2.5 text-sm text-slate-400 cursor-not-allowed">
                <Mail className="w-4 h-4 text-slate-500" />
                <span>{user?.email}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Registered Company / Business Name
              </label>
              <input 
                type="text" 
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Farina Electric, Inc."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              {companySaveSuccess ? (
                <span className="text-xs text-emerald-400 font-semibold flex items-center space-x-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Company name updated successfully!</span>
                </span>
              ) : (
                <span className="text-xs text-slate-500">Appears on public clearance links and export reports.</span>
              )}

              <button 
                type="submit"
                disabled={savingCompany}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition flex items-center space-x-2 shadow-lg shadow-blue-600/20 disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{savingCompany ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </form>
        </div>

      </main>
    </div>
  );
}