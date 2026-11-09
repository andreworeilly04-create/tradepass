'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

interface Worker {
  id: string;
  name: string;
  cardType: string;
  oshaExpDate: string;
  documentUrl?: string;
  documentName?: string;
  createdAt?: any;
}

interface UserProfile {
  companyName?: string;
  email?: string;
  subscriptionTier?: string;
  planTier?: string;
  maxWorkers?: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);

  // Add Worker Form State
  const [workerName, setWorkerName] = useState('');
  const [cardType, setCardType] = useState('OSHA 10-Hour');
  const [oshaExpDate, setOshaExpDate] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [addingWorker, setAddingWorker] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }

      setUserId(currentUser.uid);

      try {
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          setUserProfile(userDocSnap.data() as UserProfile);
        }

        const workersColRef = collection(db, `users/${currentUser.uid}/workers`);
        const workersSnapshot = await getDocs(workersColRef);
        const workersList: Worker[] = workersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Worker));

        setWorkers(workersList);
      } catch (err: any) {
        console.error('Error fetching dashboard data:', err);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  // Read tier safely across subscriptionTier and planTier schema fields
  const rawTier = (userProfile?.subscriptionTier || userProfile?.planTier || 'standard').toLowerCase();
  const userTier = rawTier.includes('enterprise') ? 'enterprise' : rawTier.includes('pro') ? 'pro' : 'standard';

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setDocumentName(file.name);
      setDocumentUrl(URL.createObjectURL(file));
    }
  };

  const handleAddWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !workerName || !oshaExpDate) return;

    const limit = userTier === 'standard' ? 10 : userTier === 'pro' ? 25 : 999;

    if (workers.length >= limit) {
      setErrorMsg(`Your ${userTier} plan is limited to ${limit} workers. Please upgrade to add more.`);
      return;
    }

    setAddingWorker(true);
    setErrorMsg('');

    try {
      const newWorkerData = {
        name: workerName,
        cardType,
        oshaExpDate,
        documentUrl: documentUrl || '',
        documentName: documentName || '',
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, `users/${userId}/workers`), newWorkerData);
      
      const newWorkerItem: Worker = {
        id: docRef.id,
        name: workerName,
        cardType,
        oshaExpDate,
        documentUrl: documentUrl || '',
        documentName: documentName || '',
        createdAt: new Date().toISOString()
      };

      setWorkers([...workers, newWorkerItem]);
      setWorkerName('');
      setOshaExpDate('');
      setDocumentUrl('');
      setDocumentName('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to add worker.');
    } finally {
      setAddingWorker(false);
    }
  };

  const handleDeleteWorker = async (workerId: string) => {
    if (!userId || !confirm('Are you sure you want to remove this worker record?')) return;

    try {
      await deleteDoc(doc(db, `users/${userId}/workers`, workerId));
      setWorkers(workers.filter(w => w.id !== workerId));
    } catch (err: any) {
      alert('Failed to delete worker record.');
    }
  };

  const handleLogout = async () => {
    await auth.signOut();
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading TradePass Dashboard...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col p-6">
      <div className="max-w-4xl w-full mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-xl font-bold text-white">{userProfile?.companyName || 'TradePass Contractor'}</h1>
            <p className="text-xs text-slate-400">Active Tier: <span className="text-blue-400 font-semibold uppercase">{userTier}</span></p>
          </div>
          <div className="flex items-center space-x-3">
            <Link href="/settings" className="text-xs text-slate-400 hover:text-white">Settings</Link>
            <button onClick={handleLogout} className="text-xs text-rose-400 hover:text-rose-300">Sign Out</button>
          </div>
        </div>

        {/* GC Passport Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-bold text-white mb-1">GC Passport Share Link</h2>
          {userTier === 'standard' ? (
            <p className="text-xs text-slate-400">
              Shareable GC passport links are locked on the Standard plan.{' '}
              <Link href="/settings" className="text-blue-400 underline">Upgrade to Crew Pro</Link> to unlock public sharing.
            </p>
          ) : (
            <div className="flex items-center space-x-2 mt-2">
              <input
                type="text"
                readOnly
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/passport/${userId}`}
                className="bg-slate-950 border border-slate-800 text-xs text-slate-300 px-3 py-1.5 rounded w-full font-mono"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/passport/${userId}`);
                  alert('Copied to clipboard!');
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded transition"
              >
                Copy
              </button>
            </div>
          )}
        </div>

        {/* Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-bold text-white mb-3">Add Worker Profile & Document</h2>
          {errorMsg && <div className="text-xs text-rose-400 mb-2">{errorMsg}</div>}
          
          <form onSubmit={handleAddWorker} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="text"
                required
                placeholder="Worker Name"
                value={workerName}
                onChange={(e) => setWorkerName(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-xs text-white p-2 rounded"
              />
              <select
                value={cardType}
                onChange={(e) => setCardType(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-xs text-white p-2 rounded"
              >
                <option value="OSHA 10-Hour">OSHA 10-Hour</option>
                <option value="OSHA 30-Hour">OSHA 30-Hour</option>
                <option value="General Liability Insurance">General Liability Insurance</option>
                <option value="Workers Compensation">Workers Compensation</option>
                <option value="State Trade License">State Trade License</option>
              </select>
              <input
                type="date"
                required
                value={oshaExpDate}
                onChange={(e) => setOshaExpDate(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-xs text-white p-2 rounded"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Attach License PDF or Image</label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={handleFileUpload}
                className="bg-slate-950 border border-slate-800 text-xs text-slate-400 p-1.5 rounded w-full file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-slate-800 file:text-slate-300 hover:file:bg-slate-700 cursor-pointer"
              />
            </div>

            <button
              type="submit"
              disabled={addingWorker}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 rounded transition"
            >
              {addingWorker ? 'Adding Worker...' : 'Add Worker'}
            </button>
          </form>
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-bold text-white mb-3">Crew Members ({workers.length})</h2>
          {workers.length === 0 ? (
            <p className="text-xs text-slate-500">No workers registered.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Card</th>
                  <th className="pb-2">Expiration</th>
                  <th className="pb-2">Document</th>
                  <th className="pb-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {workers.map((w) => (
                  <tr key={w.id}>
                    <td className="py-2 text-white font-medium">{w.name}</td>
                    <td className="py-2 text-slate-400">{w.cardType}</td>
                    <td className="py-2 text-slate-400">{w.oshaExpDate}</td>
                    <td className="py-2 text-slate-400">
                      {w.documentUrl ? (
                        <a href={w.documentUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                          View PDF
                        </a>
                      ) : (
                        <span className="text-slate-600">None</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => handleDeleteWorker(w.id)} className="text-rose-400 hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}