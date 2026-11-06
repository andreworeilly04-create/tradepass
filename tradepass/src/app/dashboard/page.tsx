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
  X
} from 'lucide-react';
import { collection, addDoc, doc, onSnapshot, query, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

interface UserProfile {
  companyName?: string;
  planTier?: string;
  maxWorkers?: number;
}

interface Worker {
  id: string;
  name: string;
  role: string;
  trade: string;
  status: 'Compliant' | 'Warning' | 'Expired';
  docsCount: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);

  // New Worker Form State
  const [workerName, setWorkerName] = useState('');
  const [workerRole, setWorkerRole] = useState('');
  const [workerTrade, setWorkerTrade] = useState('Electrical');
  const [submitting, setSubmitting] = useState(false);

  // Auth Guard
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Fetch User Profile Document dynamically
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
      snapshot.forEach((doc) => {
        workerList.push({ id: doc.id, ...doc.data() } as Worker);
      });
      setWorkers(workerList);
    });

    return () => unsubscribeWorkers();
  }, [user]);

  const companyName = profile?.companyName || user?.displayName || 'My Company';
  const planTier = profile?.planTier || 'Crew Pro';
  const maxWorkers = profile?.maxWorkers || 10;

  const handleAddWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !workerName) return;

    try {
      setSubmitting(true);
      await addDoc(collection(db, 'users', user.uid, 'workers'), {
        name: workerName,
        role: workerRole || 'Technician',
        trade: workerTrade,
        status: 'Compliant',
        docsCount: 1,
        createdAt: serverTimestamp()
      });

      setWorkerName('');
      setWorkerRole('');
      setShowUploadModal(false);
    } catch (err) {
      console.error("Error adding worker:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredWorkers = workers.filter(w => 
    w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    w.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalActive = workers.length;
  const compliantCount = workers.filter(w => w.status === 'Compliant').length;
  const warningCount = workers.filter(w => w.status === 'Warning').length;
  const expiredCount = workers.filter(w => w.status === 'Expired').length;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        Loading TradePass Dashboard...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-6 py-8 w-full flex-grow">
        
        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            Compliance Command Center
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Manage worker credentials and job-site access for <span className="text-slate-200 font-semibold">{companyName}</span>.
          </p>
        </div>

        {/* Summary Cards */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <article className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
            <header className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Active Crew</span>
              <Users className="w-5 h-5 text-blue-400" />
            </header>
            <div className="text-3xl font-extrabold text-white">{totalActive} / {maxWorkers}</div>
            <span className="text-xs text-slate-500 mt-1 block">{planTier} Plan</span>
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
            <span className="text-xs text-slate-500 mt-1 block">Action required within 30 days</span>
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

        {/* Roster Controls */}
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
            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-blue-600/20 flex items-center justify-center space-x-2 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Worker & Document</span>
          </button>
        </section>

        {/* Crew Roster Table */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <header className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Crew Roster & Compliance</h2>
            <span className="text-xs text-slate-400">{filteredWorkers.length} workers registered</span>
          </header>

          <div className="overflow-x-auto">
            {filteredWorkers.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                No workers found. Click &quot;Add Worker & Document&quot; above to add your first crew member.
              </div>
            ) : (
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950/50 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-3">Worker Name</th>
                    <th className="px-6 py-3">Role / Specialty</th>
                    <th className="px-6 py-3">Compliance Status</th>
                    <th className="px-6 py-3">Documents</th>
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
                      <td className="px-6 py-4 text-slate-400">{worker.docsCount} items uploaded</td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => alert(`Viewing documents for ${worker.name}`)}
                          className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition"
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

        {/* Modal */}
        {showUploadModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <header className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-white">Add Crew Member & Doc</h3>
                <button 
                  onClick={() => setShowUploadModal(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </header>

              <form onSubmit={handleAddWorker} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
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
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Role / Specialty
                  </label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Journeyman Electrician"
                    value={workerRole}
                    onChange={(e) => setWorkerRole(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-6 text-center cursor-pointer transition bg-slate-950/50">
                  <Upload className="w-7 h-7 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-300 font-medium">Click to select PDF or image file</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">License, Insurance Binder, or OSHA Card</p>
                </div>

                <button 
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl text-xs transition disabled:opacity-50"
                >
                  {submitting ? 'Saving to Cloud...' : 'Confirm & Save Worker'}
                </button>
              </form>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}