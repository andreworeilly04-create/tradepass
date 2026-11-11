'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Users, 
  AlertTriangle, 
  Plus, 
  CheckCircle2, 
  Clock, 
  Search,
  Upload,
  X,
  ShieldAlert,
  Copy,
  Check,
  ExternalLink,
  Lock,
  FileText,
  Palette,
  UserCheck,
  Trash2,
  Share2,
  FileCheck
} from 'lucide-react';
import { 
  collection, 
  addDoc, 
  doc, 
  onSnapshot, 
  query, 
  serverTimestamp, 
  updateDoc, 
  deleteDoc,
  arrayUnion, 
  arrayRemove 
} from 'firebase/firestore';
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
}

interface Worker {
  id: string;
  name: string;
  role: string;
  trade: string;
  oshaCertNumber?: string;
  oshaExpDate?: string;
  fileName?: string;
  status?: 'Compliant' | 'Warning' | 'Expired';
  docsCount: number;
}

function formatDateString(dateStr?: string): string {
  if (!dateStr) return 'N/A';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${parseInt(month, 10)}/${parseInt(day, 10)}/${year}`;
}

function getComplianceStatus(expDateStr?: string): 'Compliant' | 'Warning' | 'Expired' {
  if (!expDateStr) return 'Compliant';

  const parts = expDateStr.split('-');
  if (parts.length !== 3) return 'Compliant';

  const expYear = parseInt(parts[0], 10);
  const expMonth = parseInt(parts[1], 10) - 1;
  const expDay = parseInt(parts[2], 10);

  const expDate = new Date(expYear, expMonth, expDay);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffTime = expDate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Expired';
  if (diffDays <= 30) return 'Warning';
  return 'Compliant';
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showForemanModal, setShowForemanModal] = useState(false);
  const [showBrandingModal, setShowBrandingModal] = useState(false);
  
  // Worker Deletion & Details Modals
  const [workerToDelete, setWorkerToDelete] = useState<Worker | null>(null);
  const [deletingWorker, setDeletingWorker] = useState(false);
  const [workerDetailsModal, setWorkerDetailsModal] = useState<Worker | null>(null);

  const [copiedLink, setCopiedLink] = useState(false);

  const [workerName, setWorkerName] = useState('');
  const [workerRole, setWorkerRole] = useState('');
  const [workerTrade, setWorkerTrade] = useState('General');
  const [oshaCertNumber, setOshaCertNumber] = useState('');
  const [oshaExpDate, setOshaExpDate] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [newForemanEmail, setNewForemanEmail] = useState('');
  const [brandingLogoUrl, setBrandingLogoUrl] = useState('');
  const [brandingColor, setBrandingColor] = useState('#0ea5e9');

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribeUser = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as UserProfile;
        setProfile(data);
        if (data.companyLogoUrl) setBrandingLogoUrl(data.companyLogoUrl);
        if (data.brandColor) setBrandingColor(data.brandColor);
      }
    });

    return () => unsubscribeUser();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, 'users', user.uid, 'workers'));
    const unsubscribeWorkers = onSnapshot(q, (snapshot) => {
      const workerList: Worker[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const calculatedStatus = getComplianceStatus(data.oshaExpDate);
        workerList.push({ 
          id: docSnap.id, 
          ...data,
          status: calculatedStatus 
        } as Worker);
      });
      setWorkers(workerList);
    });

    return () => unsubscribeWorkers();
  }, [user]);

  const companyName = profile?.companyName || user?.displayName || 'My Company';
  
  const rawTier = (profile?.planTier || '').toLowerCase();
  const isEnterpriseTier = rawTier.includes('enterprise') || rawTier.includes('multi-crew');
  const isStandardTier = rawTier.includes('standard') && !isEnterpriseTier;

  const planTierDisplay = isEnterpriseTier 
    ? 'Multi-Crew Enterprise' 
    : isStandardTier 
    ? 'Standard Crew' 
    : 'Crew Pro';
  
  const getMaxWorkersLimit = () => {
    if (isEnterpriseTier) return 999;
    if (rawTier.includes('pro')) return 25;
    return 10;
  };

  const maxWorkers = getMaxWorkersLimit();
  const totalActive = workers.length;
  const isAtCapacity = !isEnterpriseTier && totalActive >= maxWorkers;
  const brandColor = profile?.brandColor || '#0ea5e9';

  const subscriptionStatus = profile?.subscriptionStatus || 'active';
  const isSubscriptionExpired = subscriptionStatus === 'expired' || subscriptionStatus === 'canceled' || subscriptionStatus === 'past_due';

  const handleSharePassport = async () => {
    if (!user?.uid) return;

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const passportUrl = `${origin}/passport/${user.uid}`;
    const shareData = {
      title: `${companyName} - TradePass Clearance Roster`,
      text: `Here is our live TradePass job-site safety clearance roster for ${companyName}:`,
      url: passportUrl,
    };

    try {
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(passportUrl);
        } else {
          const textArea = document.createElement('textarea');
          textArea.value = passportUrl;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2500);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Error sharing passport link:', err);
      }
    }
  };

  const handleCopyPassport = async () => {
    if (!user?.uid) return;

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const passportUrl = `${origin}/passport/${user.uid}`;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(passportUrl);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = passportUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch (err) {
      console.error('Failed to copy public passport link:', err);
    }
  };

  const handleDownloadDigest = () => {
    const today = new Date();
    const dateStr = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;

    let digestText = `===================================================\n`;
    digestText += `         TRADEPASS COMPLIANCE DIGEST REPORT        \n`;
    digestText += `===================================================\n`;
    digestText += `Company: ${companyName}\n`;
    digestText += `Plan Tier: ${planTierDisplay}\n`;
    digestText += `Generated Date: ${dateStr}\n`;
    digestText += `Total Active Workers: ${totalActive} / ${isEnterpriseTier ? 'Unlimited' : maxWorkers}\n`;
    digestText += `===================================================\n\n`;

    digestText += `SUMMARY STATS:\n`;
    digestText += `- Compliant: ${compliantCount}\n`;
    digestText += `- Expiring Soon (Within 30 Days): ${warningCount}\n`;
    digestText += `- Action Needed (Expired): ${expiredCount}\n\n`;

    digestText += `===================================================\n`;
    digestText += `ITEMIZED WORKER ROSTER BREAKDOWN:\n`;
    digestText += `===================================================\n\n`;

    if (workers.length === 0) {
      digestText += `No worker profiles registered in roster.\n`;
    } else {
      workers.forEach((w, index) => {
        digestText += `${index + 1}. WORKER: ${w.name.toUpperCase()}\n`;
        digestText += `   - Trade & Role: ${w.trade || 'General'} — ${w.role}\n`;
        digestText += `   - Compliance Status: [${w.status?.toUpperCase()}]\n`;
        digestText += `   - OSHA Cert Number: ${w.oshaCertNumber || 'N/A'}\n`;
        digestText += `   - OSHA Expiration Date: ${formatDateString(w.oshaExpDate)}\n`;
        digestText += `   - Attached Verification Document: ${w.fileName || 'None'}\n`;
        digestText += `---------------------------------------------------\n`;
      });
    }

    digestText += `\nEnd of Itemized Compliance Digest Report.\n`;

    const blob = new Blob([digestText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `TradePass_Compliance_Digest_${companyName.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleAddWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!user || !workerName) return;

    if (isAtCapacity) {
      setFormError(`Plan limit reached (${maxWorkers} worker profiles max). Upgrade plan to add more crew members.`);
      return;
    }

    try {
      setSubmitting(true);
      await addDoc(collection(db, 'users', user.uid, 'workers'), {
        name: workerName,
        role: workerRole || 'Technician',
        trade: workerTrade || 'General',
        oshaCertNumber: oshaCertNumber || 'N/A',
        oshaExpDate: oshaExpDate || '',
        fileName: selectedFile ? selectedFile.name : null,
        docsCount: selectedFile || oshaCertNumber ? 1 : 0,
        createdAt: serverTimestamp()
      });

      setWorkerName('');
      setWorkerRole('');
      setWorkerTrade('General');
      setOshaCertNumber('');
      setOshaExpDate('');
      setSelectedFile(null);
      setShowUploadModal(false);
    } catch (err: any) {
      console.error("Error adding worker:", err);
      setFormError(err.message || 'Failed to add worker profile.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteWorker = async () => {
    if (!user || !workerToDelete) return;

    try {
      setDeletingWorker(true);
      await deleteDoc(doc(db, 'users', user.uid, 'workers', workerToDelete.id));
      setWorkerToDelete(null);
    } catch (err) {
      console.error("Error deleting worker profile:", err);
    } finally {
      setDeletingWorker(false);
    }
  };

  const handleAddForeman = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newForemanEmail) return;

    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        foremanEmails: arrayUnion(newForemanEmail.trim().toLowerCase())
      });
      setNewForemanEmail('');
    } catch (err) {
      console.error("Error adding foreman:", err);
    }
  };

  const handleRemoveForeman = async (emailToRemove: string) => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        foremanEmails: arrayRemove(emailToRemove)
      });
    } catch (err) {
      console.error("Error removing foreman:", err);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        companyLogoUrl: brandingLogoUrl.trim(),
        brandColor: brandingColor
      });
      setShowBrandingModal(false);
    } catch (err) {
      console.error("Error updating branding:", err);
    }
  };

  const filteredWorkers = workers.filter(w => 
    w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    w.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (w.trade && w.trade.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const compliantCount = workers.filter(w => w.status === 'Compliant').length;
  const warningCount = workers.filter(w => w.status === 'Warning').length;
  const expiredCount = workers.filter(w => w.status === 'Expired').length;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-sans">
        Loading TradePass Command Center...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      <main className="max-w-7xl mx-auto px-6 py-8 w-full flex-grow">
        
        {/* Dynamic Expiration / Past-Due Alert Banner */}
        {isSubscriptionExpired && (
          <div className="mb-6 p-4 bg-rose-950/40 border border-rose-800/80 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 text-rose-300 text-sm shadow-xl">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-rose-900/50 rounded-xl border border-rose-700/50 flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h4 className="font-bold text-white">Your TradePass plan has expired</h4>
                <p className="text-xs text-rose-300/80 mt-0.5">
                  {subscriptionStatus === 'past_due'
                    ? 'Your recent subscription auto-payment failed. Please update your payment details to reactivate.'
                    : 'Your subscription cycle ended. Renew your plan to reactivate public clearance links and worker tracking.'}
                </p>
              </div>
            </div>
            <button 
              onClick={() => router.push('/signup')}
              className="w-full sm:w-auto bg-rose-600 hover:bg-rose-500 text-white font-bold px-4 py-2 rounded-xl text-xs transition shadow-lg shadow-rose-600/20 flex-shrink-0 cursor-pointer"
            >
              Renew Subscription
            </button>
          </div>
        )}

        {/* Navigation & Company Branding Header */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800/80 pb-6">
          <div className="flex items-center space-x-4">
            {profile?.companyLogoUrl ? (
              <img 
                src={profile.companyLogoUrl} 
                alt="Company Logo" 
                className="w-12 h-12 object-contain rounded-xl bg-slate-900 border border-slate-800 p-1"
              />
            ) : (
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center font-extrabold text-white text-xl shadow-lg ring-2 ring-white/10"
                style={{ 
                  backgroundColor: brandColor || '#3b82f6',
                  boxShadow: `0 0 20px ${brandColor}40`
                }}
              >
                {companyName.charAt(0)}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center space-x-2">
                <span style={{ color: brandColor && brandColor !== '#0ea5e9' ? brandColor : '#ffffff' }}>
                  {companyName}
                </span>
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">
                Compliance Command Center • Job-site access & worker certifications.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 flex-wrap sm:flex-nowrap gap-y-2">
            {isEnterpriseTier && (
              <>
                <button
                  onClick={() => setShowBrandingModal(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 flex items-center space-x-1.5 transition cursor-pointer"
                >
                  <Palette className="w-3.5 h-3.5 text-sky-400" />
                  <span>Branding</span>
                </button>

                <button
                  onClick={() => setShowForemanModal(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 flex items-center space-x-1.5 transition cursor-pointer"
                >
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Foremen ({profile?.foremanEmails?.length || 0})</span>
                </button>
              </>
            )}

            <span 
              className="text-xs font-bold px-3 py-1.5 rounded-full border uppercase tracking-wider"
              style={{
                color: brandColor,
                borderColor: `${brandColor}40`,
                backgroundColor: `${brandColor}15`
              }}
            >
              {planTierDisplay}
            </span>

            <button
              onClick={() => router.push('/signup')}
              className="text-xs text-slate-400 hover:text-white underline transition ml-1 cursor-pointer"
            >
              Change Tier
            </button>
          </div>
        </div>

        {/* GC Passport Link & Export Widget */}
        <div className="mb-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <span>Shareable GC Public Passport Link</span>
              {isStandardTier && (
                <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-normal">Standard: Internal Tracking</span>
              )}
              {isEnterpriseTier && (
                <span className="text-[10px] bg-sky-500/20 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded font-medium">Custom Branded</span>
              )}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {isStandardTier 
                ? 'Standard plan uses internal tracking. Upgrade to Crew Pro ($79/mo) or Enterprise to unlock shareable public roster links & itemized compliance digest reports.' 
                : 'Share your live clearance link via text or email, or export itemized compliance digest reports for General Contractors.'}
            </p>
          </div>

          {isStandardTier ? (
            <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
              <div className="flex items-center space-x-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-xl">
                <Lock className="w-3.5 h-3.5" />
                <span>Public Link & Digest Locked</span>
              </div>
              <button
                onClick={() => router.push('/signup')}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer"
              >
                Upgrade to Pro
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2 w-full md:w-auto flex-wrap sm:flex-nowrap">
              <button
                onClick={handleDownloadDigest}
                className="flex-1 md:flex-initial bg-slate-800 hover:bg-slate-750 text-white text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-700 flex items-center justify-center space-x-1.5 transition cursor-pointer"
                title="Download Itemized Compliance Digest Report"
              >
                <FileText className="w-4 h-4 text-blue-400" />
                <span>Digest</span>
              </button>
              
              <button
                type="button"
                onClick={handleSharePassport}
                className="flex-1 md:flex-initial bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl transition flex items-center justify-center space-x-1.5 shadow-lg shadow-blue-600/20 cursor-pointer"
                title="Share via Text, Email, or Messaging Apps"
              >
                <Share2 className="w-4 h-4" />
                <span>Share Link</span>
              </button>

              <button
                type="button"
                onClick={handleCopyPassport}
                className={`flex-1 md:flex-initial text-xs font-semibold px-3.5 py-2.5 rounded-xl border transition flex items-center justify-center space-x-1.5 cursor-pointer ${
                  copiedLink
                    ? 'bg-emerald-950/60 border-emerald-500 text-emerald-400'
                    : 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-white'
                }`}
              >
                {copiedLink ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-400" />
                    <span>Copy Link</span>
                  </>
                )}
              </button>

              {user?.uid && (
                <a
                  href={`/passport/${user.uid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl flex items-center justify-center transition cursor-pointer"
                  title="Open Public Passport Roster in New Tab"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Compliance Summary Statistics */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <article className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
            <header className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Active Crew</span>
              <Users className="w-5 h-5 text-emerald-400" />
            </header>
            <div className="text-3xl font-extrabold text-white">
              {totalActive} <span className="text-lg text-slate-500 font-normal">/ {isEnterpriseTier ? '∞' : maxWorkers}</span>
            </div>
            <span className="text-xs text-slate-500 mt-1 block">
              {isEnterpriseTier ? 'Priority 30, 15, 7, & 1-Day Urgent Alerts' : isStandardTier ? 'Automated 30 & 15-Day Alerts' : 'Automated 30, 15, 7, & 1-Day Alerts'}
            </span>
          </article>

          <article className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
            <header className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Compliant</span>
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </header>
            <div className="text-3xl font-extrabold text-emerald-400">{compliantCount}</div>
            <span className="text-xs text-slate-500 mt-1 block">Clear for job site</span>
          </article>

          <article className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
            <header className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Expiring Soon</span>
              <Clock className="w-5 h-5 text-amber-400" />
            </header>
            <div className="text-3xl font-extrabold text-amber-400">{warningCount}</div>
            <span className="text-xs text-slate-500 mt-1 block">Expires within 30 days</span>
          </article>

          <article className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
            <header className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Action Needed</span>
              <AlertTriangle className="w-5 h-5 text-rose-500" />
            </header>
            <div className="text-3xl font-extrabold text-rose-500">{expiredCount}</div>
            <span className="text-xs text-slate-500 mt-1 block">Expired documents</span>
          </article>
        </section>

        {isAtCapacity && (
          <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-amber-400 text-sm">
            <div className="flex items-center space-x-3">
              <ShieldAlert className="w-5 h-5 flex-shrink-0" />
              <span>{planTierDisplay} limit reached ({totalActive}/{maxWorkers} worker profiles). Upgrade to Multi-Crew Enterprise for Unlimited Workers & Staff.</span>
            </div>
            <button 
              onClick={() => router.push('/signup')}
              className="bg-amber-500 text-slate-950 font-bold px-4 py-1.5 rounded-lg text-xs hover:bg-amber-400 transition cursor-pointer"
            >
              Upgrade Plan
            </button>
          </div>
        )}

        {/* Search & Actions Controls */}
        <section className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search crew members..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          <button 
            onClick={() => setShowUploadModal(true)}
            disabled={isAtCapacity}
            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-blue-600/20 flex items-center justify-center space-x-2 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Worker Profile</span>
          </button>
        </section>

        {/* Main Crew Roster Table */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <header className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Crew Roster & Compliance</h2>
            <span className="text-xs text-slate-400">{filteredWorkers.length} of {isEnterpriseTier ? 'Unlimited' : maxWorkers} profile slots used</span>
          </header>

          <div className="overflow-x-auto">
            {filteredWorkers.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                No worker profiles created yet. Click &quot;Add Worker Profile&quot; to build your roster.
              </div>
            ) : (
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950/50 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-3">Worker Name</th>
                    <th className="px-6 py-3">Trade / Role</th>
                    <th className="px-6 py-3">Compliance Status</th>
                    <th className="px-6 py-3">OSHA Expiration</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredWorkers.map((worker) => (
                    <tr key={worker.id} className="hover:bg-slate-800/40 transition">
                      <td className="px-6 py-4 font-semibold text-white">{worker.name}</td>
                      <td className="px-6 py-4 text-slate-400">
                        <span className="text-white font-medium">{worker.trade || 'General'}</span> • {worker.role}
                      </td>
                      <td className="px-6 py-4">
                        {worker.status === 'Compliant' && (
                          <span className="inline-flex items-center space-x-1.5 bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 text-xs px-3 py-1 rounded-full font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Compliant</span>
                          </span>
                        )}
                        {worker.status === 'Warning' && (
                          <span className="inline-flex items-center space-x-1.5 bg-amber-950/80 text-amber-400 border border-amber-800/60 text-xs px-3 py-1 rounded-full font-semibold">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Expires Soon</span>
                          </span>
                        )}
                        {worker.status === 'Expired' && (
                          <span className="inline-flex items-center space-x-1.5 bg-rose-950/80 text-rose-400 border border-rose-800/60 text-xs px-3 py-1 rounded-full font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Non-Compliant</span>
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-400">
                        {formatDateString(worker.oshaExpDate)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-3">
                          {/* View Details Modal Trigger */}
                          <button 
                            onClick={() => setWorkerDetailsModal(worker)}
                            className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition cursor-pointer"
                          >
                            View Details
                          </button>

                          <button
                            onClick={() => setWorkerToDelete(worker)}
                            className="p-1 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                            title="Delete Worker Profile"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Modal: Worker Details Breakdown */}
        {workerDetailsModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2 text-blue-400">
                  <FileCheck className="w-5 h-5" />
                  <h3 className="text-lg font-bold text-white">Worker Certification Details</h3>
                </div>
                <button 
                  onClick={() => setWorkerDetailsModal(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 text-sm text-slate-300">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">Full Name</span>
                    <span className="text-base font-bold text-white">{workerDetailsModal.name}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">Trade</span>
                      <span className="text-slate-200 font-semibold">{workerDetailsModal.trade || 'General'}</span>
                    </div>
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">Role / Specialty</span>
                      <span className="text-slate-200">{workerDetailsModal.role}</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">OSHA Card Number</span>
                    <span className="font-mono text-white bg-slate-900 px-2 py-1 rounded border border-slate-800 text-xs inline-block mt-0.5">
                      {workerDetailsModal.oshaCertNumber || 'N/A'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">Expiration Date</span>
                      <span className="text-slate-200">{formatDateString(workerDetailsModal.oshaExpDate)}</span>
                    </div>
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">Status</span>
                      <span className={`font-semibold ${workerDetailsModal.status === 'Compliant' ? 'text-emerald-400' : workerDetailsModal.status === 'Warning' ? 'text-amber-400' : 'text-rose-400'}`}>
                        {workerDetailsModal.status}
                      </span>
                    </div>
                  </div>

                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">Attached Verification Document</span>
                    <span className="text-xs text-blue-400 flex items-center space-x-1.5 mt-0.5">
                      <FileText className="w-3.5 h-3.5" />
                      <span>{workerDetailsModal.fileName || 'No document attached'}</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <button
                  onClick={() => setWorkerDetailsModal(null)}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2.5 rounded-xl text-xs transition cursor-pointer"
                >
                  Close Details
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Delete Worker Confirmation */}
        {workerToDelete && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center space-x-2 text-rose-500">
                  <AlertTriangle className="w-5 h-5" />
                  <h3 className="text-lg font-bold text-white">Delete Worker Profile?</h3>
                </div>
                <button 
                  onClick={() => setWorkerToDelete(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm text-slate-300 mb-6">
                Are you sure you want to remove <span className="font-bold text-white">&quot;{workerToDelete.name}&quot;</span> from your crew roster? This action is permanent and deletes all associated certification metadata.
              </p>

              <div className="flex space-x-3">
                <button
                  onClick={() => setWorkerToDelete(null)}
                  className="w-1/2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2.5 rounded-xl text-xs transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteWorker}
                  disabled={deletingWorker}
                  className="w-1/2 bg-rose-600 hover:bg-rose-500 text-white font-semibold py-2.5 rounded-xl text-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {deletingWorker ? 'Deleting...' : 'Delete Profile'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Add Worker Profile */}
        {showUploadModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <header className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-white">Add Crew Worker Profile</h3>
                <button 
                  onClick={() => setShowUploadModal(false)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </header>

              {formError && (
                <div className="mb-4 p-3 bg-red-950/50 border border-red-800 text-red-300 text-xs rounded-xl flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleAddWorker} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Worker Full Name
                  </label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Marcus Vance"
                    value={workerName}
                    onChange={(e) => setWorkerName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Trade Specialty
                  </label>
                  <select
                    value={workerTrade}
                    onChange={(e) => setWorkerTrade(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="General">General / Other</option>
                    <option value="Flooring">Flooring</option>
                    <option value="Electrical">Electrical</option>
                    <option value="Plumbing">Plumbing</option>
                    <option value="HVAC">HVAC</option>
                    <option value="Carpentry">Carpentry</option>
                    <option value="Roofing">Roofing</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Role / Position
                  </label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Flooring Technician"
                    value={workerRole}
                    onChange={(e) => setWorkerRole(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    OSHA Card Number
                  </label>
                  <input 
                    type="text" 
                    placeholder="e.g. OSHA-30-99482"
                    value={oshaCertNumber}
                    onChange={(e) => setOshaCertNumber(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    OSHA Card Expiration Date
                  </label>
                  <input 
                    type="date" 
                    required
                    value={oshaExpDate}
                    onChange={(e) => setOshaExpDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Certification Document (PDF or Photo)
                  </label>
                  <label className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-4 text-center cursor-pointer transition bg-slate-950/50 flex flex-col items-center justify-center">
                    <Upload className="w-6 h-6 text-slate-400 mb-1.5" />
                    <span className="text-xs text-slate-300 font-medium">
                      {selectedFile ? selectedFile.name : 'Click to select PDF or image file'}
                    </span>
                    <span className="text-[10px] text-slate-500 mt-0.5">OSHA Card, Trade License, or Insurance Binder</span>
                    <input 
                      type="file"
                      accept=".pdf,image/*"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setSelectedFile(e.target.files[0]);
                        }
                      }}
                    />
                  </label>
                </div>

                <button 
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl text-xs transition disabled:opacity-50 shadow-lg shadow-blue-600/20 cursor-pointer"
                >
                  {submitting ? 'Saving Profile...' : 'Save Worker Profile'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Foremen Management */}
        {showForemanModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <header className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <UserCheck className="w-5 h-5 text-emerald-400" />
                  <span>Multiple Foreman Accounts</span>
                </h3>
                <button 
                  onClick={() => setShowForemanModal(false)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </header>

              <p className="text-xs text-slate-400 mb-4">
                Enterprise plan allows authorized field foremen to log in, view compliance status, and submit worker documents.
              </p>

              <form onSubmit={handleAddForeman} className="flex gap-2 mb-4">
                <input 
                  type="email" 
                  required
                  placeholder="foreman@company.com"
                  value={newForemanEmail}
                  onChange={(e) => setNewForemanEmail(e.target.value)}
                  className="flex-grow bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
                <button 
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-2 rounded-xl text-xs transition cursor-pointer"
                >
                  Add
                </button>
              </form>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {(!profile?.foremanEmails || profile.foremanEmails.length === 0) ? (
                  <p className="text-xs text-slate-500 text-center py-4">No secondary foreman emails added yet.</p>
                ) : (
                  profile.foremanEmails.map((email) => (
                    <div key={email} className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300">
                      <span>{email}</span>
                      <button 
                        onClick={() => handleRemoveForeman(email)}
                        className="text-slate-500 hover:text-rose-400 transition cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal: Custom Branding */}
        {showBrandingModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <header className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <Palette className="w-5 h-5 text-sky-400" />
                  <span>Custom Company Branding</span>
                </h3>
                <button 
                  onClick={() => setShowBrandingModal(false)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </header>

              <p className="text-xs text-slate-400 mb-4">
                Custom logo & color scheme appear on your TradePass dashboard header and public GC passport links.
              </p>

              <form onSubmit={handleSaveBranding} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Company Logo URL
                  </label>
                  <input 
                    type="url" 
                    placeholder="https://yourcompany.com/logo.png"
                    value={brandingLogoUrl}
                    onChange={(e) => setBrandingLogoUrl(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Brand Accent Color
                  </label>
                  <div className="flex items-center space-x-3">
                    <input 
                      type="color" 
                      value={brandingColor}
                      onChange={(e) => setBrandingColor(e.target.value)}
                      className="w-10 h-10 rounded-lg bg-transparent cursor-pointer border-0"
                    />
                    <input 
                      type="text" 
                      value={brandingColor}
                      onChange={(e) => setBrandingColor(e.target.value)}
                      className="flex-grow bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold py-3 rounded-xl text-xs transition shadow-lg shadow-sky-500/20 cursor-pointer"
                >
                  Save Custom Branding
                </button>
              </form>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}