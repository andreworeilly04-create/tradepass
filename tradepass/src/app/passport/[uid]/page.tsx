'use client';

import React, { useEffect, useState, use } from 'react';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  ShieldCheck,
  X,
  Maximize2,
} from 'lucide-react';

const DEFAULT_TIME_ZONE = 'America/New_York';

interface UserProfile {
  companyName?: string;
  planTier?: string;
  companyLogoUrl?: string;
  brandColor?: string;
  timeZone?: string;
  timezone?: string;
}

interface WorkerCertificate {
  id: string;
  label: string;
  certNumber?: string;
  expDate?: string;
  fileName?: string | null;
  fileUrl?: string | null;
}

interface Worker {
  id: string;
  name: string;
  role: string;
  trade?: string;
  certificates?: WorkerCertificate[];
  oshaCertNumber?: string;
  oshaExpDate?: string;
}

interface LightboxPreview {
  workerName: string;
  certLabel: string;
  certNumber?: string;
  expDate?: string;
  imageUrl: string;
}

function getSafeTimeZone(timeZone?: string | null): string {
  const candidate =
    typeof timeZone === 'string' && timeZone.trim()
      ? timeZone.trim()
      : DEFAULT_TIME_ZONE;

  try {
    Intl.DateTimeFormat(undefined, { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function getStartOfDayInTimeZone(date: Date, timeZone: string): Date {
  const safeTz = getSafeTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);

  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function formatDateString(dateStr?: string): string {
  if (!dateStr) return 'No Expiration';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${parseInt(month, 10)}/${parseInt(day, 10)}/${year}`;
}

function getComplianceStatus(
  expDateStr?: string,
  timeZone: string = DEFAULT_TIME_ZONE
): 'Compliant' | 'Warning' | 'Expired' {
  if (!expDateStr) return 'Compliant';

  const parts = expDateStr.split('-');
  if (parts.length !== 3) return 'Compliant';

  const expYear = parseInt(parts[0], 10);
  const expMonth = parseInt(parts[1], 10) - 1;
  const expDay = parseInt(parts[2], 10);

  if (Number.isNaN(expYear) || Number.isNaN(expMonth) || Number.isNaN(expDay)) {
    return 'Compliant';
  }

  const expDate = new Date(expYear, expMonth, expDay, 0, 0, 0, 0);
  const today = getStartOfDayInTimeZone(new Date(), timeZone);

  const diffDays = Math.round(
    (expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays <= 0) return 'Expired';
  if (diffDays <= 30) return 'Warning';
  return 'Compliant';
}

function getSafeImageUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://')
  ) {
    return trimmed;
  }

  return null;
}

function normalizeWorkerCertificates(data: any): WorkerCertificate[] {
  if (Array.isArray(data?.certificates) && data.certificates.length > 0) {
    return data.certificates.map((cert: any, idx: number) => ({
      id: cert.id || `cert-${idx}`,
      label: cert.label || `Certificate #${idx + 1}`,
      certNumber: cert.certNumber || '',
      expDate: cert.expDate || '',
      fileName: cert.fileName || null,
      fileUrl: cert.fileUrl || null,
    }));
  }

  const hasLegacyData =
    (data?.oshaCertNumber && data.oshaCertNumber !== 'N/A') ||
    Boolean(data?.oshaExpDate) ||
    Boolean(data?.fileUrl);

  if (hasLegacyData) {
    return [
      {
        id: 'legacy-cert-0',
        label: 'Primary Credential',
        certNumber:
          data.oshaCertNumber && data.oshaCertNumber !== 'N/A'
            ? data.oshaCertNumber
            : '',
        expDate: data.oshaExpDate || '',
        fileName: data.fileName || null,
        fileUrl: data.fileUrl || null,
      },
    ];
  }

  return [];
}

function getWorkerOverallStatus(
  certificates: WorkerCertificate[],
  timeZone: string
): 'Compliant' | 'Warning' | 'Expired' {
  if (!certificates || certificates.length === 0) return 'Compliant';

  let hasWarning = false;
  for (const cert of certificates) {
    const status = getComplianceStatus(cert.expDate, timeZone);
    if (status === 'Expired') return 'Expired';
    if (status === 'Warning') hasWarning = true;
  }

  return hasWarning ? 'Warning' : 'Compliant';
}

export default function PublicPassportPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const resolvedParams = use(params);
  const uid = resolvedParams.uid;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<LightboxPreview | null>(null);

  useEffect(() => {
    async function fetchPublicPassportData() {
      if (!uid) return;
      try {
        const userDocRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userDocRef);
        let profileData: UserProfile | null = null;

        if (userSnap.exists()) {
          profileData = userSnap.data() as UserProfile;
          setProfile(profileData);
        }

        const workersSnap = await getDocs(
          collection(db, 'users', uid, 'workers')
        );
        const list: Worker[] = [];
        workersSnap.forEach((docSnap) => {
          const raw = docSnap.data();
          const certs = normalizeWorkerCertificates(raw);
          list.push({
            id: docSnap.id,
            name: raw.name || 'Unnamed Worker',
            role: raw.role || 'Technician',
            trade: raw.trade || 'General',
            certificates: certs,
            oshaCertNumber: raw.oshaCertNumber,
            oshaExpDate: raw.oshaExpDate,
          });
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

  const activeTimeZone = getSafeTimeZone(
    profile?.timeZone || profile?.timezone
  );
  const companyName = profile?.companyName || 'Subcontractor Roster';
  const brandColor = profile?.brandColor || '#0ea5e9';
  const logoUrl = profile?.companyLogoUrl;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 font-sans">
      <div className="max-w-5xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl">
        
        {/* Dynamic Branded Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-6 mb-6 gap-4">
          <div className="flex items-center space-x-4 min-w-0">
            {logoUrl ? (
              <img 
                src={logoUrl} 
                alt={`${companyName} Logo`} 
                className="w-14 h-14 object-contain rounded-xl bg-slate-950 border border-slate-800 p-1 shrink-0"
              />
            ) : (
              <div 
                className="w-14 h-14 rounded-xl flex items-center justify-center font-bold text-slate-950 text-2xl shadow-md shrink-0"
                style={{ backgroundColor: brandColor }}
              >
                {companyName.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold text-white flex items-center space-x-2 truncate">
                <span className="truncate">{companyName}</span>
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Verified TradePass Job-Site Compliance Roster
              </p>
            </div>
          </div>

          <span 
            className="self-start sm:self-auto text-xs font-bold px-3.5 py-1.5 rounded-full border uppercase tracking-wider flex items-center space-x-1.5 shrink-0"
            style={{ 
              color: brandColor, 
              borderColor: `${brandColor}40`, 
              backgroundColor: `${brandColor}15` 
            }}
          >
            <ShieldCheck className="w-4 h-4 shrink-0" />
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
            <table className="w-full text-left text-sm text-slate-300 min-w-[680px]">
              <thead className="bg-slate-950/60 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Worker Name</th>
                  <th className="px-4 py-3">Trade / Role</th>
                  <th className="px-4 py-3">Certificates &amp; Expirations</th>
                  <th className="px-4 py-3 text-right">Clearance Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {workers.map((w) => {
                  const certs = w.certificates || [];
                  const status = getWorkerOverallStatus(certs, activeTimeZone);

                  return (
                    <tr key={w.id} className="hover:bg-slate-800/30 transition align-top">
                      <td className="px-4 py-4 font-semibold text-white whitespace-nowrap">
                        {w.name}
                      </td>
                      <td className="px-4 py-4 text-slate-400 whitespace-nowrap">
                        <span className="text-slate-200 font-medium">
                          {w.trade || 'General'}
                        </span>{' '}
                        • {w.role}
                      </td>
                      <td className="px-4 py-4">
                        {certs.length === 0 ? (
                          <span className="text-xs text-slate-500">
                            No certificates on file
                          </span>
                        ) : (
                          <div className="space-y-2.5">
                            {certs.map((cert, idx) => {
                              const certStatus = getComplianceStatus(
                                cert.expDate,
                                activeTimeZone
                              );
                              const safeImageUrl = getSafeImageUrl(cert.fileUrl);
                              const certTitle =
                                cert.label || `Certificate #${idx + 1}`;

                              return (
                                <div
                                  key={cert.id || idx}
                                  className="bg-slate-950/70 border border-slate-800/80 rounded-lg px-3 py-2.5 text-xs space-y-2"
                                >
                                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                                    <div className="space-y-0.5">
                                      <div className="font-semibold text-white">
                                        {certTitle}
                                        {cert.certNumber && (
                                          <span className="ml-2 font-mono text-[11px] text-slate-400 font-normal">
                                            #{cert.certNumber}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-slate-400">
                                        Exp: {formatDateString(cert.expDate)}
                                      </div>
                                    </div>

                                    <span
                                      className={`self-start sm:self-center text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                                        certStatus === 'Compliant'
                                          ? 'bg-emerald-950/70 text-emerald-400 border-emerald-800/60'
                                          : certStatus === 'Warning'
                                          ? 'bg-amber-950/70 text-amber-400 border-amber-800/60'
                                          : 'bg-rose-950/70 text-rose-400 border-rose-800/60'
                                      }`}
                                    >
                                      {certStatus === 'Compliant'
                                        ? 'Cleared'
                                        : certStatus === 'Warning'
                                        ? 'Expires Soon'
                                        : 'Expired'}
                                    </span>
                                  </div>

                                  {safeImageUrl && (
                                    <div className="pt-1.5 border-t border-slate-800/70">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setLightbox({
                                            workerName: w.name,
                                            certLabel: certTitle,
                                            certNumber: cert.certNumber,
                                            expDate: cert.expDate,
                                            imageUrl: safeImageUrl,
                                          })
                                        }
                                        className="group relative inline-flex items-center gap-2.5 text-left cursor-pointer"
                                        title="Click to view full-size certificate image"
                                      >
                                        <img
                                          src={safeImageUrl}
                                          alt={`${w.name} - ${certTitle}`}
                                          className="h-16 w-24 rounded-md object-cover border border-slate-700 bg-slate-900 group-hover:border-blue-400 transition"
                                        />
                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-400 group-hover:text-blue-300">
                                          <Maximize2 className="w-3.5 h-3.5 shrink-0" />
                                          <span>View Certificate</span>
                                        </span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right whitespace-nowrap">
                        {status === 'Compliant' && (
                          <span className="inline-flex items-center space-x-1.5 text-xs font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2.5 py-1 rounded-full">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>Cleared</span>
                          </span>
                        )}
                        {status === 'Warning' && (
                          <span className="inline-flex items-center space-x-1.5 text-xs font-semibold text-amber-400 bg-amber-950/60 border border-amber-800/50 px-2.5 py-1 rounded-full">
                            <Clock className="w-3.5 h-3.5 shrink-0" />
                            <span>Expires Soon</span>
                          </span>
                        )}
                        {status === 'Expired' && (
                          <span className="inline-flex items-center space-x-1.5 text-xs font-semibold text-rose-400 bg-rose-950/60 border border-rose-800/50 px-2.5 py-1 rounded-full">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
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

      {/* Full-Size Certificate Image Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 max-w-2xl w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white">
                  {lightbox.workerName} — {lightbox.certLabel}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {lightbox.certNumber ? `Cert #${lightbox.certNumber} • ` : ''}
                  Expires: {formatDateString(lightbox.expDate)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="text-slate-400 hover:text-white cursor-pointer p-1"
                aria-label="Close certificate preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-center">
              <img
                src={lightbox.imageUrl}
                alt={`${lightbox.workerName} - ${lightbox.certLabel}`}
                className="max-h-[65vh] w-auto max-w-full rounded-lg object-contain"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}