'use client';

import React, { useEffect, useState, use } from 'react';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CheckCircle2, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';

interface UserProfile {
  companyName?: string;
  planTier?: string;
  companyLogoUrl?: string;
  brandColor?: string;
}

interface Worker {
  id: string;
  name: string;
  role: string;
  trade: string;
  oshaCertNumber?: string;
  oshaExpDate?: string;
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

  const diffDays = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Expired';
  if (diffDays <= 30) return 'Warning';
  return 'Compliant';
}

export default function PublicPassportPage({ params }: { params: Promise<{ uid: string }> }) {
  // Unwrap the params promise using React.use()
  const resolvedParams = use(params);
  const uid = resolvedParams.uid;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPublicPassportData() {
      if (!uid) return;
      try {
        const userDocRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
          setProfile(userSnap.data() as UserProfile);
        }

        const workersSnap = await getDocs(collection(db, 'users', uid, 'workers'));
        const list: Worker[] = [];
        workersSnap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as Worker);
        });

        setWorkers(list);
      } catch (err) {
        console.error('Error fetching public passport roster:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchPublicPassportData();
  }, [uid]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center font-sans">
        Verifying Job-Site Roster Clearance...
      </div>
    );
  }

  const companyName = profile?.companyName || 'Subcontractor Roster';
  const brandColor = profile?.brandColor || '#0ea5e9';
  const logoUrl = profile?.companyLogoUrl;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-sans">
      <div className="max-w-4xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        
        {/* Dynamic Branded Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-6 mb-6 gap-4">
          <div className="flex items-center space-x-4">
            {logoUrl ? (
              <img 
                src={logoUrl} 
                alt={`${companyName} Logo`} 
                className="w-14 h-14 object-contain rounded-xl bg-slate-950 border border-slate-800 p-1"
              />
            ) : (
              <div 
                className="w-14 h-14 rounded-xl flex items-center justify-center font-bold text-slate-950 text-2xl shadow-md"
                style={{ backgroundColor: brandColor }}
              >
                {companyName.charAt(0)}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-extrabold text-white flex items-center space-x-2">
                <span>{companyName}</span>
              </h1>
              <p className="text-xs text-slate-400 mt-1">Verified TradePass Job-Site Compliance Roster</p>
            </div>
          </div>

          <span 
            className="self-start sm:self-auto text-xs font-bold px-3.5 py-1.5 rounded-full border uppercase tracking-wider flex items-center space-x-1.5"
            style={{ 
              color: brandColor, 
              borderColor: `${brandColor}40`, 
              backgroundColor: `${brandColor}15` 
            }}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Active Clearance</span>
          </span>
        </div>

        {/* Read-Only Public Roster Table */}
        <div className="overflow-x-auto">
          {workers.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No active worker certifications published for this job-site roster.
            </div>
          ) : (
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/60 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Worker Name</th>
                  <th className="px-4 py-3">Role / Specialty</th>
                  <th className="px-4 py-3">OSHA Cert #</th>
                  <th className="px-4 py-3">Expiration Date</th>
                  <th className="px-4 py-3 text-right">Clearance Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {workers.map((w) => {
                  const status = getComplianceStatus(w.oshaExpDate);
                  return (
                    <tr key={w.id} className="hover:bg-slate-800/30 transition">
                      <td className="px-4 py-3.5 font-semibold text-white">{w.name}</td>
                      <td className="px-4 py-3.5 text-slate-400">{w.role}</td>
                      <td className="px-4 py-3.5 text-slate-400 font-mono text-xs">{w.oshaCertNumber || 'N/A'}</td>
                      <td className="px-4 py-3.5 text-slate-400">{formatDateString(w.oshaExpDate)}</td>
                      <td className="px-4 py-3.5 text-right">
                        {status === 'Compliant' && (
                          <span className="inline-flex items-center space-x-1.5 text-xs font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2.5 py-1 rounded-full">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Cleared</span>
                          </span>
                        )}
                        {status === 'Warning' && (
                          <span className="inline-flex items-center space-x-1.5 text-xs font-semibold text-amber-400 bg-amber-950/60 border border-amber-800/50 px-2.5 py-1 rounded-full">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Expires Soon</span>
                          </span>
                        )}
                        {status === 'Expired' && (
                          <span className="inline-flex items-center space-x-1.5 text-xs font-semibold text-rose-400 bg-rose-950/60 border border-rose-800/50 px-2.5 py-1 rounded-full">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Denied</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}