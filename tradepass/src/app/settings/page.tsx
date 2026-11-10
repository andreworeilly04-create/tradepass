'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Building, 
  Mail, 
  CheckCircle2, 
  AlertTriangle, 
  Save, 
  Lock,
  ArrowLeft,
  RefreshCw,
  XCircle,
  X
} from 'lucide-react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

interface UserProfile {
  companyName?: string;
  planTier?: string;
  maxWorkers?: number;
  subscriptionStatus?: string;
  companyLogoUrl?: string;
  brandColor?: string;
  foremanEmails?: string[];
  stripeSubscriptionId?: string;
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
  
  // Custom Inline Notification State
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
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        companyName: companyName.trim()
      });
      setCompanySaveSuccess(true);
      setTimeout(() => setCompanySaveSuccess(false), 3000);
    } catch (err: any) {
      console.error("Error saving company name:", err);
      showNotification('error', 'Failed to update company name. Please try again.');
    } finally {
      setSavingCompany(false);
    }
  };

  // Toggle Subscription Cancellation State
  const handleToggleSubscription = async (targetAction: 'cancel' | 'resume') => {
    if (!user) return;

    try {
      setUpdatingSubscription(true);

      // Call API Endpoint if Stripe integration is set up
      if (profile?.stripeSubscriptionId) {
        const response = await fetch('/api/subscription/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: profile.stripeSubscriptionId,
            action: targetAction,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to update subscription on Stripe');
        }
      }

      // Sync updated state directly with Firestore
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        subscriptionStatus: targetAction === 'cancel' ? 'canceling' : 'active',
      });

      showNotification(
        'success', 
        targetAction === 'cancel' 
          ? 'Subscription updated to cancel at the end of your billing cycle.' 
          : 'Subscription successfully resumed and set to auto-renew.'
      );

    } catch (err: any) {
      console.error(`Error trying to ${targetAction} subscription:`, err);
      showNotification('error', `Could not ${targetAction} subscription. Please try again or contact support.`);
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
  const isExpired = subscriptionStatus === 'expired' || subscriptionStatus === 'canceled' || subscriptionStatus === 'past_due';
  const isCanceling = subscriptionStatus === 'canceling';

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
        
        {/* Top Header Navigation */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button 
              onClick={() => router.push('/dashboard')}
              className="text-xs text-slate-400 hover:text-white flex items-center space-x-1.5 transition mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Command Center</span>
            </button>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Account & Subscription Settings</h1>
            <p className="text-sm text-slate-400 mt-0.5">Manage your company profile, billing subscription, and tier features.</p>
          </div>
        </div>

        {/* Global Notification Banner */}
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
              className="text-slate-400 hover:text-white transition p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Dynamic Subscription Status & Plan Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
            <div>
              {/* Status Badge */}
              <span 
                className={`inline-flex items-center space-x-1.5 border text-xs px-3 py-1 rounded-full font-semibold mb-3 ${
                  isExpired
                    ? 'bg-rose-950/80 text-rose-400 border-rose-800/60'
                    : isCanceling
                    ? 'bg-amber-950/80 text-amber-400 border-amber-800/60'
                    : 'bg-blue-950 text-blue-400 border-blue-800/60'
                }`}
              >
                {isExpired ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                ) : isCanceling ? (
                  <XCircle className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span>
                  {isExpired 
                    ? 'Your plan has expired' 
                    : isCanceling 
                    ? 'Subscription Canceling (Active until end of period)' 
                    : 'Active Subscription'}
                </span>
              </span>

              <h2 className="text-xl font-bold text-white">
                {isExpired ? 'No Active Plan' : currentPlan}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {isExpired 
                  ? 'Your account features and public GC links are temporarily locked. Renew to resume full access.' 
                  : isCanceling
                  ? 'Your subscription will not auto-renew at the end of the current billing cycle.'
                  : `Covers up to ${profile?.maxWorkers === 999 ? 'Unlimited' : profile?.maxWorkers || 10} active workers.`}
              </p>
            </div>

            {/* Subscription Action Controls */}
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              {isCanceling ? (
                <button
                  onClick={() => handleToggleSubscription('resume')}
                  disabled={updatingSubscription}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition shadow-lg shadow-emerald-600/20 flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${updatingSubscription ? 'animate-spin' : ''}`} />
                  <span>{updatingSubscription ? 'Resuming...' : 'Resume Subscription'}</span>
                </button>
              ) : !isExpired ? (
                <button
                  onClick={() => handleToggleSubscription('cancel')}
                  disabled={updatingSubscription}
                  className="bg-slate-800 hover:bg-rose-950/50 hover:text-rose-400 border border-slate-700 hover:border-rose-800/80 text-slate-300 font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5 text-rose-400" />
                  <span>{updatingSubscription ? 'Canceling...' : 'Cancel Subscription'}</span>
                </button>
              ) : (
                <button 
                  onClick={() => router.push('/signup')}
                  className="bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition shadow-lg shadow-rose-600/20"
                >
                  Renew Plan Now
                </button>
              )}

              <button 
                onClick={() => router.push('/signup')}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition shadow-lg shadow-blue-600/20"
              >
                Change Tier
              </button>
            </div>
          </div>

          <div className="pt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl">
              <div className="text-slate-400 mb-1 font-semibold uppercase tracking-wider">Worker Limit</div>
              <div className="text-base font-bold text-white">
                {isEnterpriseTier ? 'Unlimited' : profile?.maxWorkers || 10} Slots
              </div>
            </div>

            <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl">
              <div className="text-slate-400 mb-1 font-semibold uppercase tracking-wider">Public GC Passport Link</div>
              <div className="text-base font-bold text-white flex items-center space-x-1">
                {isStandardTier ? (
                  <span className="text-amber-400 flex items-center space-x-1">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Locked</span>
                  </span>
                ) : (
                  <span className="text-emerald-400">Unlocked</span>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl">
              <div className="text-slate-400 mb-1 font-semibold uppercase tracking-wider">Custom Branding & Foremen</div>
              <div className="text-base font-bold text-white flex items-center space-x-1">
                {!isEnterpriseTier ? (
                  <span className="text-slate-500 flex items-center space-x-1">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Enterprise Only</span>
                  </span>
                ) : (
                  <span className="text-sky-400">Active</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Company Profile Settings Form */}
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
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition flex items-center space-x-2 shadow-lg shadow-blue-600/20 disabled:opacity-50"
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