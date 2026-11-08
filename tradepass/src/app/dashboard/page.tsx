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
  FileText
} from 'lucide-react';
import { collection, addDoc, doc, onSnapshot, query, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

interface UserProfile {
  companyName?: string;
  planTier?: string;
  maxWorkers?: number;
  subscriptionStatus?: string;
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

// Dynamic Expiration Checker
function getComplianceStatus(expDateStr?: string): 'Compliant' | 'Warning' | 'Expired' {
  if (!expDateStr) return 'Compliant';
  const today = new Date();
  const expDate = new Date(expDateStr);
  const diffDays = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'Expired';
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
  const [copiedLink, setCopiedLink] = useState(false);

  // New Worker Form State
  const [workerName, setWorkerName] = useState('');
  const [workerRole, setWorkerRole] = useState('');
  const [workerTrade, setWorkerTrade] = useState('Electrical');
  const [oshaCertNumber, setOshaCertNumber] = useState('');
  const [oshaExpDate, setOshaExpDate] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Auth Guard
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Fetch User Profile Document dynamically from Firestore
  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribeUser = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        setProfile(snapshot.data() as UserProfile);
      }
    });

    return () => unsubscribeUser();
  }, [user]);

  // Fetch Workers Subcollection dynamically
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
  const planTier = profile?.planTier || 'Standard Crew';
  
  // Dynamic max workers mapping based on plan tier
  const getMaxWorkersLimit = (tier?: string) => {
    switch (tier?.toLowerCase()) {
      case 'standard crew':
      case 'standard': return 10;
      case 'crew pro':
      case 'growth': return 25;
      case 'multi-crew enterprise':
      case 'pro': return 999;
      default: return profile?.maxWorkers || 10;
    }
  };

  const maxWorkers = getMaxWorkersLimit(planTier);
  const totalActive = workers.length;
  const isAtCapacity = totalActive >= maxWorkers;

  const handleCopyPassport = () => {
    if (!user) return;
    const passportUrl = `${window.location.origin}/passport/${user.uid}`;
    navigator.clipboard.writeText(passportUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 3000);
  };

  const handleAddWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!user || !workerName) return;

    if (isAtCapacity) {
      setFormError(`Standard limit reached (${maxWorkers} worker profiles max). Please upgrade to add more crew members.`);
      return;
    }

    try {
      setSubmitting(true);
      await addDoc(collection(db, 'users', user.uid, 'workers'), {
        name: workerName,
        role: workerRole || 'Technician',
        trade: workerTrade,
        oshaCertNumber: oshaCertNumber || 'N/A',
        oshaExpDate: oshaExpDate || '',
        fileName: selectedFile ? selectedFile.name : null,
        docsCount: selectedFile || oshaCertNumber ? 1 : 0,
        createdAt: serverTimestamp()
      });

      // Reset Form State
      setWorkerName('');
      setWorkerRole('');
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

  const filteredWorkers = workers.filter(w => 
    w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    w.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const compliantCount = workers.filter(w => w.status === 'Compliant').length;
  const warningCount = workers.filter(w => w.status === 'Warning').length;
  const expiredCount = workers.filter(w => w.status === 'Expired').length;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-sans">
        Loading TradePass Dashboard...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-6 py-8 w-full flex-grow">
        
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            Compliance Command Center
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Manage worker credentials and job-site access for <span className="text-slate-200 font-semibold">{companyName}</span>.
          </p>
        </div>

        {/* GC Passport Share Widget */}
        <div className="mb-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-white">Instant GC Clearance Passport</h3>
            <p className="text-xs text-slate-400">Share your live clearance link with General Contractors for instant site entry verification.</p>
          </div>
          <div className="flex items-center space-x-2 w-full md:w-auto">
            <button
              onClick={handleCopyPassport}
              className="flex-1 md:flex-initial bg-slate-800 hover:bg-slate-750 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-slate-700 flex items-center justify-center space-x-2 transition"
            >
              {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
              <span>{copiedLink ? 'Link Copied!' : 'Copy GC Link'}</span>
            </button>
            {user && (
              <a
                href={`/passport/${user.uid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-2.5 rounded-xl flex items-center justify-center transition"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <article className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
            <header className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Active Crew</span>
              <Users className="w-5 h-5 text-emerald-400" />
            </header>
            <div className="text-3xl font-extrabold text-white">
              {totalActive} <span className="text-lg text-slate-500 font-normal">/ {maxWorkers === 999 ? '∞' : maxWorkers}</span>
            </div>
            <span className="text-xs text-slate-500 mt-1 block capitalize">{planTier} Plan</span>
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

        {/* Capacity Warning Banner if full */}
        {isAtCapacity && (
          <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-amber-400 text-sm">
            <div className="flex items-center space-x-3">
              <ShieldAlert className="w-5 h-5 flex-shrink-0" />
              <span>Standard tier cap reached ({totalActive}/{maxWorkers} worker profiles). Upgrade to Crew Pro to add up to 25 workers.</span>
            </div>
            <button 
              onClick={() => router.push('/signup')}
              className="bg-amber-500 text-slate-950 font-bold px-4 py-1.5 rounded-lg text-xs hover:bg-amber-400 transition"
            >
              Upgrade Plan
            </button>
          </div>
        )}

        {/* Roster Controls */}
        <section className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search crew members..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
            />
          </div>

          <button 
            onClick={() => setShowUploadModal(true)}
            disabled={isAtCapacity}
            className="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center space-x-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            <span>Add Worker Profile</span>
          </button>
        </section>

        {/* Crew Roster Table */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <header className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Crew Roster & Compliance</h2>
            <span className="text-xs text-slate-400">{filteredWorkers.length} of {maxWorkers} profile slots used</span>
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
                    <th className="px-6 py-3">Role / Specialty</th>
                    <th className="px-6 py-3">Compliance Status</th>
                    <th className="px-6 py-3">OSHA Expiration</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredWorkers.map((worker) => (
                    <tr key={worker.id} className="hover:bg-slate-800/40 transition">
                      <td className="px-6 py-4 font-semibold text-white">{worker.name}</td>
                      <td className="px-6 py-4 text-slate-400">{worker.role}</td>
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
                        {worker.oshaExpDate ? new Date(worker.oshaExpDate).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => alert(`Worker: ${worker.name}\nOSHA #: ${worker.oshaCertNumber || 'N/A'}\nExp Date: ${worker.oshaExpDate || 'N/A'}\nAttached Doc: ${worker.fileName || 'None'}`)}
                          className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition"
                        >
                          View Details →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Add Worker Modal */}
        {showUploadModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <header className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-white">Add Crew Worker Profile</h3>
                <button 
                  onClick={() => setShowUploadModal(false)}
                  className="text-slate-400 hover:text-white"
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
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Role / Specialty
                  </label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Journeyman Electrician"
                    value={workerRole}
                    onChange={(e) => setWorkerRole(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
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
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
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
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Restored Document Upload Drop Zone */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Certification Document (PDF or Photo)
                  </label>
                  <label className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-4 text-center cursor-pointer transition bg-slate-950/50 flex flex-col items-center justify-center">
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
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold py-3 rounded-xl text-xs transition disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                >
                  {submitting ? 'Saving Profile...' : 'Save Worker Profile'}
                </button>
              </form>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}