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
  FileCheck,
  Pencil
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
import { db, auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

const MAX_RAW_INPUT_BYTES = 8 * 1024 * 1024; // Allow up to 8 MB raw photos/screenshots before auto-compression
const MAX_COMPRESSED_DATA_URL_CHARS = 180 * 1024; // ~180 KB per compressed certificate image
const MAX_TOTAL_DOC_DATA_CHARS = 800 * 1024; // Stay safely under Firestore's 1 MiB document limit
const DEFAULT_TIME_ZONE = 'America/New_York';

interface UserProfile {
  companyName?: string;
  planTier?: string;
  maxWorkers?: number;
  subscriptionStatus?: string;
  cancelAtPeriodEnd?: boolean;
  companyLogoUrl?: string;
  brandColor?: string;
  foremanEmails?: string[];
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
  trade: string;
  certificates?: WorkerCertificate[];
  oshaCertNumber?: string;
  oshaExpDate?: string;
  fileName?: string | null;
  fileUrl?: string | null;
  status?: 'Compliant' | 'Warning' | 'Expired';
  docsCount: number;
}

function createCertificateDraft(overrides?: Partial<WorkerCertificate>): WorkerCertificate {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: '',
    certNumber: '',
    expDate: '',
    fileName: null,
    fileUrl: null,
    ...overrides,
  };
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
    Boolean(data?.fileUrl) ||
    Boolean(data?.fileName);

  if (hasLegacyData) {
    return [
      {
        id: 'legacy-cert-0',
        label: 'Primary Credential',
        certNumber: data.oshaCertNumber && data.oshaCertNumber !== 'N/A' ? data.oshaCertNumber : '',
        expDate: data.oshaExpDate || '',
        fileName: data.fileName || null,
        fileUrl: data.fileUrl || null,
      },
    ];
  }

  return [];
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

function getTodayFormattedInTimeZone(timeZone: string): string {
  const safeTz = getSafeTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
  return formatter.format(new Date());
}

function getSafeCertificateUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('data:application/pdf')
  ) {
    return trimmed;
  }

  if (!trimmed.startsWith('blob:') && !trimmed.startsWith('/')) {
    return `https://${trimmed}`;
  }

  return null;
}

function isImageCertificate(url: string): boolean {
  return (
    url.startsWith('data:image/') ||
    /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)
  );
}

async function openCertificateInNewTab(safeUrl: string): Promise<void> {
  if (safeUrl.startsWith('data:')) {
    const response = await fetch(safeUrl);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return;
  }

  window.open(safeUrl, '_blank', 'noopener,noreferrer');
}

function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(
        new Error(
          'Only image files or pasted screenshots can be saved directly without cloud storage.'
        )
      );
      return;
    }

    if (file.size > MAX_RAW_INPUT_BYTES) {
      reject(new Error('Image file is larger than 8 MB. Please choose a smaller file.'));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        URL.revokeObjectURL(objectUrl);

        // Scale down large screenshots/photos while keeping text & cert numbers crisp
        const MAX_DIMENSION = 1200;
        let { width, height } = img;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width >= height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not initialize image compressor.'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Iteratively compress as JPEG until well under per-certificate budget
        let quality = 0.78;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);

        while (dataUrl.length > MAX_COMPRESSED_DATA_URL_CHARS && quality > 0.35) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        if (dataUrl.length > MAX_COMPRESSED_DATA_URL_CHARS) {
          reject(
            new Error(
              'Certificate image is still too dense after compression. Please crop closer to the card.'
            )
          );
          return;
        }

        resolve(dataUrl);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to decode image from clipboard or file.'));
    };

    img.src = objectUrl;
  });
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

  const diffTime = expDate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Expired';
  if (diffDays <= 30) return 'Warning';
  return 'Compliant';
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

function getPrimaryCertificateForSummary(
  certificates: WorkerCertificate[]
): WorkerCertificate | undefined {
  if (!certificates || certificates.length === 0) return undefined;

  const withDates = certificates
    .filter((c) => Boolean(c.expDate))
    .sort((a, b) => (a.expDate || '').localeCompare(b.expDate || ''));

  return withDates[0] || certificates[0];
}

function sanitizeCertificatesForSave(drafts: WorkerCertificate[]): WorkerCertificate[] {
  return drafts
    .map((cert, idx) => {
      const safeUrl = getSafeCertificateUrl(cert.fileUrl);
      const cleanLabel = cert.label.trim() || `Certificate #${idx + 1}`;
      const cleanNumber = (cert.certNumber || '').trim();
      const cleanExpDate = (cert.expDate || '').trim();
      const cleanFileName = safeUrl
        ? cert.fileName || 'certificate-screenshot.jpg'
        : null;

      return {
        id: cert.id || createCertificateDraft().id,
        label: cleanLabel,
        certNumber: cleanNumber,
        expDate: cleanExpDate,
        fileName: cleanFileName,
        fileUrl: safeUrl,
      };
    })
    .filter(
      (cert) =>
        Boolean(cert.certNumber) ||
        Boolean(cert.expDate) ||
        Boolean(cert.fileUrl) ||
        drafts.length === 1
    );
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
  
  // Worker Deletion, Details & Edit Modals
  const [workerToDelete, setWorkerToDelete] = useState<Worker | null>(null);
  const [deletingWorker, setDeletingWorker] = useState(false);
  const [workerDetailsModal, setWorkerDetailsModal] = useState<Worker | null>(null);
  const [workerToEdit, setWorkerToEdit] = useState<Worker | null>(null);

  const [copiedLink, setCopiedLink] = useState(false);

  // Add Worker Form State
  const [workerName, setWorkerName] = useState('');
  const [workerRole, setWorkerRole] = useState('');
  const [workerTrade, setWorkerTrade] = useState('General');
  const [addCertificates, setAddCertificates] = useState<WorkerCertificate[]>([
    createCertificateDraft({ label: 'OSHA 30 / Safety Card' }),
  ]);
  const [activeAddCertIndex, setActiveAddCertIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Edit Worker Form State
  const [editWorkerName, setEditWorkerName] = useState('');
  const [editWorkerRole, setEditWorkerRole] = useState('');
  const [editWorkerTrade, setEditWorkerTrade] = useState('General');
  const [editCertificates, setEditCertificates] = useState<WorkerCertificate[]>([]);
  const [activeEditCertIndex, setActiveEditCertIndex] = useState(0);
  const [updatingWorker, setUpdatingWorker] = useState(false);
  const [editFormError, setEditFormError] = useState('');

  const [newForemanEmail, setNewForemanEmail] = useState('');
  const [brandingLogoUrl, setBrandingLogoUrl] = useState('');
  const [brandingColor, setBrandingColor] = useState('#0ea5e9');

  const activeTimeZone = getSafeTimeZone(profile?.timeZone || profile?.timezone);

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
        const normalizedCerts = normalizeWorkerCertificates(data);
        const calculatedStatus = getWorkerOverallStatus(normalizedCerts, activeTimeZone);
        workerList.push({ 
          id: docSnap.id, 
          ...data,
          certificates: normalizedCerts,
          docsCount: normalizedCerts.length,
          status: calculatedStatus 
        } as Worker);
      });
      setWorkers(workerList);
    });

    return () => unsubscribeWorkers();
  }, [user, activeTimeZone]);

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

  const subscriptionStatus = profile?.subscriptionStatus;

  if (!profile) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-sans">
        Loading Command Center...
      </div>
    );
  }

  const isSubscriptionActive =
    subscriptionStatus === 'active' ||
    subscriptionStatus === 'trialing';

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
    const dateStr = getTodayFormattedInTimeZone(activeTimeZone);

    let digestText = `===================================================\n`;
    digestText += `         TRADEPASS COMPLIANCE DIGEST REPORT        \n`;
    digestText += `===================================================\n`;
    digestText += `Company: ${companyName}\n`;
    digestText += `Plan Tier: ${planTierDisplay}\n`;
    digestText += `Generated Date: ${dateStr} (${activeTimeZone})\n`;
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
        const certs = w.certificates || [];
        digestText += `${index + 1}. WORKER: ${w.name.toUpperCase()}\n`;
        digestText += `   - Trade & Role: ${w.trade || 'General'} — ${w.role}\n`;
        digestText += `   - Overall Compliance Status: [${w.status?.toUpperCase()}]\n`;
        digestText += `   - Certificates on File (${certs.length}):\n`;

        if (certs.length === 0) {
          digestText += `     * No certificates attached.\n`;
        } else {
          certs.forEach((cert, cIdx) => {
            const certStatus = getComplianceStatus(cert.expDate, activeTimeZone);
            const safeUrl = getSafeCertificateUrl(cert.fileUrl);
            digestText += `     ${cIdx + 1}) ${cert.label || 'Credential'} [${certStatus.toUpperCase()}]\n`;
            digestText += `        - Policy / Cert #: ${cert.certNumber || 'N/A'}\n`;
            digestText += `        - Expiration: ${formatDateString(cert.expDate)}\n`;
            digestText += `        - Document: ${cert.fileName || 'None'}${safeUrl?.startsWith('data:image/') ? ' [Embedded Screenshot]' : ''}\n`;
          });
        }
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

  // Add Modal Certificate Handlers
  const updateAddCertificateField = (
    index: number,
    updates: Partial<WorkerCertificate>
  ) => {
    setAddCertificates((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...updates } : item))
    );
  };

  const handleAddCertificateRow = () => {
    setAddCertificates((prev) => {
      const next = [
        ...prev,
        createCertificateDraft({ label: `Certificate #${prev.length + 1}` }),
      ];
      setActiveAddCertIndex(next.length - 1);
      return next;
    });
  };

  const handleRemoveAddCertificateRow = (index: number) => {
    setAddCertificates((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, idx) => idx !== index);
      setActiveAddCertIndex((curr) => Math.min(curr, next.length - 1));
      return next;
    });
  };

  const handleAddImageSelect = async (index: number, file: File) => {
    setFormError('');
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      updateAddCertificateField(index, {
        fileName: file.name,
        fileUrl: dataUrl,
      });
    } catch (err: any) {
      setFormError(err.message || 'Could not process image.');
    }
  };

  const handleAddPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          const generatedName = `pasted-certificate-${Date.now()}.jpg`;
          const namedFile = new File([file], generatedName, { type: file.type });
          const targetIndex = Math.min(activeAddCertIndex, addCertificates.length - 1);
          await handleAddImageSelect(targetIndex, namedFile);
          return;
        }
      }
    }
  };

  // Edit Modal Certificate Handlers
  const updateEditCertificateField = (
    index: number,
    updates: Partial<WorkerCertificate>
  ) => {
    setEditCertificates((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...updates } : item))
    );
  };

  const handleEditCertificateRow = () => {
    setEditCertificates((prev) => {
      const next = [
        ...prev,
        createCertificateDraft({ label: `Certificate #${prev.length + 1}` }),
      ];
      setActiveEditCertIndex(next.length - 1);
      return next;
    });
  };

  const handleRemoveEditCertificateRow = (index: number) => {
    setEditCertificates((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, idx) => idx !== index);
      setActiveEditCertIndex((curr) => Math.min(curr, next.length - 1));
      return next;
    });
  };

  const handleEditImageSelect = async (index: number, file: File) => {
    setEditFormError('');
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      updateEditCertificateField(index, {
        fileName: file.name,
        fileUrl: dataUrl,
      });
    } catch (err: any) {
      setEditFormError(err.message || 'Could not process image.');
    }
  };

  const handleEditPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          const generatedName = `pasted-certificate-${Date.now()}.jpg`;
          const namedFile = new File([file], generatedName, { type: file.type });
          const targetIndex = Math.min(activeEditCertIndex, editCertificates.length - 1);
          await handleEditImageSelect(targetIndex, namedFile);
          return;
        }
      }
    }
  };

  const handleAddWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!user || !workerName.trim()) return;

    if (isAtCapacity) {
      setFormError(`Plan limit reached (${maxWorkers} worker profiles max). Upgrade plan to add more crew members.`);
      return;
    }

    const cleanedCerts = sanitizeCertificatesForSave(addCertificates);
    const totalPayloadSize = cleanedCerts.reduce(
      (sum, c) => sum + (c.fileUrl ? c.fileUrl.length : 0),
      0
    );

    if (totalPayloadSize > MAX_TOTAL_DOC_DATA_CHARS) {
      setFormError('Combined certificate images exceed Firestore profile limit (~800 KB max). Please remove or crop one of the screenshots.');
      return;
    }

    const primaryCert = getPrimaryCertificateForSummary(cleanedCerts);

    try {
      setSubmitting(true);

      await addDoc(collection(db, 'users', user.uid, 'workers'), {
        name: workerName.trim(),
        role: workerRole.trim() || 'Technician',
        trade: workerTrade || 'General',
        certificates: cleanedCerts,
        // Keep legacy top-level fields synced with the most urgent/primary certificate
        oshaCertNumber: primaryCert?.certNumber || 'N/A',
        oshaExpDate: primaryCert?.expDate || '',
        fileName: primaryCert?.fileName || null,
        fileUrl: primaryCert?.fileUrl || null,
        docsCount: cleanedCerts.length,
        createdAt: serverTimestamp(),
      });

      setWorkerName('');
      setWorkerRole('');
      setWorkerTrade('General');
      setAddCertificates([createCertificateDraft({ label: 'OSHA 30 / Safety Card' })]);
      setActiveAddCertIndex(0);
      setShowUploadModal(false);
    } catch (err: any) {
      console.error('Error adding worker:', err);
      setFormError(err.message || 'Failed to add worker profile.');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditWorkerModal = (worker: Worker) => {
    setWorkerDetailsModal(null);
    setEditFormError('');
    setWorkerToEdit(worker);
    setEditWorkerName(worker.name || '');
    setEditWorkerRole(worker.role || '');
    setEditWorkerTrade(worker.trade || 'General');

    const existingCerts = normalizeWorkerCertificates(worker);
    setEditCertificates(
      existingCerts.length > 0
        ? existingCerts
        : [createCertificateDraft({ label: 'OSHA 30 / Safety Card' })]
    );
    setActiveEditCertIndex(0);
  };

  const handleUpdateWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditFormError('');

    if (!user || !workerToEdit || !editWorkerName.trim()) return;

    const cleanedCerts = sanitizeCertificatesForSave(editCertificates);
    const totalPayloadSize = cleanedCerts.reduce(
      (sum, c) => sum + (c.fileUrl ? c.fileUrl.length : 0),
      0
    );

    if (totalPayloadSize > MAX_TOTAL_DOC_DATA_CHARS) {
      setEditFormError('Combined certificate images exceed Firestore profile limit (~800 KB max). Please remove or crop one of the screenshots.');
      return;
    }

    const primaryCert = getPrimaryCertificateForSummary(cleanedCerts);

    try {
      setUpdatingWorker(true);

      await updateDoc(doc(db, 'users', user.uid, 'workers', workerToEdit.id), {
        name: editWorkerName.trim(),
        role: editWorkerRole.trim() || 'Technician',
        trade: editWorkerTrade || 'General',
        certificates: cleanedCerts,
        // Keep legacy top-level fields synced with the most urgent/primary certificate
        oshaCertNumber: primaryCert?.certNumber || 'N/A',
        oshaExpDate: primaryCert?.expDate || '',
        fileName: primaryCert?.fileName || null,
        fileUrl: primaryCert?.fileUrl || null,
        docsCount: cleanedCerts.length,
        updatedAt: serverTimestamp(),
      });

      setWorkerToEdit(null);
      setEditCertificates([]);
    } catch (err: any) {
      console.error('Error updating certificates:', err);
      setEditFormError(err.message || 'Failed to update certificates.');
    } finally {
      setUpdatingWorker(false);
    }
  };

  const handleDeleteWorker = async () => {
    if (!user || !workerToDelete) return;

    try {
      setDeletingWorker(true);
      await deleteDoc(doc(db, 'users', user.uid, 'workers', workerToDelete.id));
      setWorkerToDelete(null);
    } catch (err) {
      console.error('Error deleting worker profile:', err);
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
      console.error('Error adding foreman:', err);
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
      console.error('Error removing foreman:', err);
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
      console.error('Error updating branding:', err);
    }
  };

  const filteredWorkers = workers.filter(w => 
    w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    w.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (w.trade && w.trade.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (w.certificates || []).some(
      (c) =>
        c.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.certNumber && c.certNumber.toLowerCase().includes(searchTerm.toLowerCase()))
    )
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

  if (!isSubscriptionActive) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center py-12 px-6 font-sans">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/30 rounded-2xl flex items-center justify-center mx-auto mb-5 text-blue-400 shadow-lg shadow-blue-500/10">
            <Lock className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-extrabold text-white mb-2">Subscription Required</h1>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            Your TradePass account requires an active subscription to access job-site safety tracking, worker profiles, and compliance features. Please complete your checkout to activate your account.
          </p>
          <div className="space-y-3">
            <button
              onClick={() => router.push('/signup')}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl text-sm transition shadow-lg shadow-blue-600/20 cursor-pointer"
            >
              Choose Plan &amp; Complete Checkout
            </button>
            <button
              onClick={() => auth.signOut().then(() => router.push('/login'))}
              className="w-full bg-slate-800 hover:bg-slate-750 text-slate-300 font-semibold py-2.5 rounded-xl text-xs transition cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 w-full flex-grow">

        {/* Navigation & Company Branding Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-6">
          <div className="flex items-center space-x-3.5 min-w-0">
            {profile?.companyLogoUrl ? (
              <img 
                src={profile.companyLogoUrl} 
                alt="Company Logo" 
                className="w-12 h-12 object-contain rounded-xl bg-slate-900 border border-slate-800 p-1 shrink-0"
              />
            ) : (
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center font-extrabold text-white text-xl shadow-lg ring-2 ring-white/10 shrink-0"
                style={{ 
                  backgroundColor: brandColor || '#3b82f6',
                  boxShadow: `0 0 20px ${brandColor}40`
                }}
              >
                {companyName.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight truncate">
                <span style={{ color: brandColor && brandColor !== '#0ea5e9' ? brandColor : '#ffffff' }}>
                  {companyName}
                </span>
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-0.5 truncate">
                Compliance Command Center • Job-site access &amp; worker certifications ({activeTimeZone}).
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 flex-wrap gap-y-2">
            {isEnterpriseTier && (
              <>
                <button
                  onClick={() => setShowBrandingModal(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 flex items-center space-x-1.5 transition cursor-pointer whitespace-nowrap"
                >
                  <Palette className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span>Branding</span>
                </button>

                <button
                  onClick={() => setShowForemanModal(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 flex items-center space-x-1.5 transition cursor-pointer whitespace-nowrap"
                >
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Foremen ({profile?.foremanEmails?.length || 0})</span>
                </button>
              </>
            )}

            <span 
              className="text-xs font-bold px-3 py-1.5 rounded-full border uppercase tracking-wider whitespace-nowrap"
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
              className="text-xs text-slate-400 hover:text-white underline transition ml-1 cursor-pointer whitespace-nowrap"
            >
              Change Tier
            </button>
          </div>
        </div>

        {/* GC Passport Link & Export Widget */}
        <div className="mb-8 bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-white flex flex-wrap items-center gap-2">
              <span>Shareable GC Public Passport Link</span>
              {isStandardTier && (
                <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-normal whitespace-nowrap">Standard: Internal Tracking</span>
              )}
              {isEnterpriseTier && (
                <span className="text-[10px] bg-sky-500/20 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded font-medium whitespace-nowrap">Custom Branded</span>
              )}
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              {isStandardTier 
                ? 'Standard plan uses internal tracking. Upgrade to Crew Pro ($79/mo) or Enterprise to unlock shareable public roster links & itemized compliance digest reports.' 
                : 'Share your live clearance link via text or email, or export itemized compliance digest reports for General Contractors.'}
            </p>
          </div>

          {isStandardTier ? (
            <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
              <div className="flex items-center space-x-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-xl whitespace-nowrap">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>Public Link &amp; Digest Locked</span>
              </div>
              <button
                onClick={() => router.push('/signup')}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer whitespace-nowrap"
              >
                Upgrade to Pro
              </button>
            </div>
          ) : (
            <div className="flex items-center space-y-2 sm:space-y-0 sm:space-x-2 w-full md:w-auto flex-wrap sm:flex-nowrap">
              <button
                onClick={handleDownloadDigest}
                className="w-full sm:w-auto bg-slate-800 hover:bg-slate-750 text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl border border-slate-700 flex items-center justify-center space-x-1.5 transition cursor-pointer whitespace-nowrap"
                title="Download Itemized Compliance Digest Report"
              >
                <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Digest</span>
              </button>
              
              <button
                type="button"
                onClick={handleSharePassport}
                className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl transition flex items-center justify-center space-x-1.5 shadow-lg shadow-blue-600/20 cursor-pointer whitespace-nowrap"
                title="Share via Text, Email, or Messaging Apps"
              >
                <Share2 className="w-4 h-4 shrink-0" />
                <span>Share Link</span>
              </button>

              <button
                type="button"
                onClick={handleCopyPassport}
                className={`w-full sm:w-auto text-xs font-semibold px-3.5 py-2.5 rounded-xl border transition flex items-center justify-center space-x-1.5 cursor-pointer whitespace-nowrap ${
                  copiedLink
                    ? 'bg-emerald-950/60 border-emerald-500 text-emerald-400'
                    : 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-white'
                }`}
              >
                {copiedLink ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>Copy Link</span>
                  </>
                )}
              </button>

              {user?.uid && (
                <a
                  href={`/passport/${user.uid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl flex items-center justify-center transition cursor-pointer whitespace-nowrap"
                  title="Open Public Passport Roster in New Tab"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Compliance Summary Statistics */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
          <article className="bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-800">
            <header className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Active Crew</span>
              <Users className="w-5 h-5 text-emerald-400" />
            </header>
            <div className="text-3xl font-extrabold text-white">
              {totalActive} <span className="text-lg text-slate-500 font-normal">/ {isEnterpriseTier ? '∞' : maxWorkers}</span>
            </div>
            <span className="text-xs text-slate-500 mt-1 block">
              {isEnterpriseTier ? 'Priority 30, 15, 7, & 1-Day Urgent Alerts' : isStandardTier ? 'Automated 30 & 15-Day Alerts' : 'Automated 30, 15, 7 Day Alerts'}
            </span>
          </article>

          <article className="bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-800">
            <header className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Compliant</span>
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </header>
            <div className="text-3xl font-extrabold text-emerald-400">{compliantCount}</div>
            <span className="text-xs text-slate-500 mt-1 block">Clear for job site</span>
          </article>

          <article className="bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-800">
            <header className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Expiring Soon</span>
              <Clock className="w-5 h-5 text-amber-400" />
            </header>
            <div className="text-3xl font-extrabold text-amber-400">{warningCount}</div>
            <span className="text-xs text-slate-500 mt-1 block">Expires within 30 days</span>
          </article>

          <article className="bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-800">
            <header className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Action Needed</span>
              <AlertTriangle className="w-5 h-5 text-rose-500" />
            </header>
            <div className="text-3xl font-extrabold text-rose-500">{expiredCount}</div>
            <span className="text-xs text-slate-500 mt-1 block">Expired documents</span>
          </article>
        </section>

        {isAtCapacity && (
          <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-400 text-sm">
            <div className="flex items-center space-x-3">
              <ShieldAlert className="w-5 h-5 flex-shrink-0" />
              <span>{planTierDisplay} limit reached ({totalActive}/{maxWorkers} worker profiles). Upgrade to Multi-Crew Enterprise for Unlimited Workers &amp; Staff.</span>
            </div>
            <button 
              onClick={() => router.push('/signup')}
              className="bg-amber-500 text-slate-950 font-bold px-4 py-1.5 rounded-lg text-xs hover:bg-amber-400 transition cursor-pointer whitespace-nowrap"
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
              placeholder="Search crew or certificates..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          <button 
            onClick={() => {
              setFormError('');
              setShowUploadModal(true);
            }}
            disabled={isAtCapacity}
            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-blue-600/20 flex items-center justify-center space-x-2 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Add Worker Profile</span>
          </button>
        </section>

        {/* Main Crew Roster Table */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <header className="px-4 sm:px-6 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-white">Crew Roster &amp; Compliance</h2>
            <span className="text-xs text-slate-400">{filteredWorkers.length} of {isEnterpriseTier ? 'Unlimited' : maxWorkers} profile slots used</span>
          </header>

          <div className="overflow-x-auto">
            {filteredWorkers.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                No worker profiles created yet. Click &quot;Add Worker Profile&quot; to build your roster.
              </div>
            ) : (
              <table className="w-full text-left text-sm text-slate-300 min-w-[680px]">
                <thead className="bg-slate-950/50 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-3">Worker Name</th>
                    <th className="px-6 py-3">Trade / Role</th>
                    <th className="px-6 py-3">Certificates</th>
                    <th className="px-6 py-3">Compliance Status</th>
                    <th className="px-6 py-3">Next Expiration</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredWorkers.map((worker) => {
                    const certs = worker.certificates || [];
                    const nextExpiringCert = getPrimaryCertificateForSummary(certs);

                    return (
                      <tr key={worker.id} className="hover:bg-slate-800/40 transition">
                        <td className="px-6 py-4 font-semibold text-white whitespace-nowrap">{worker.name}</td>
                        <td className="px-6 py-4 text-slate-400">
                          <span className="text-white font-medium">{worker.trade || 'General'}</span> • {worker.role}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center space-x-1.5 bg-slate-950 border border-slate-800 text-slate-300 text-xs px-2.5 py-1 rounded-lg font-medium">
                            <FileCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            <span>
                              {certs.length} {certs.length === 1 ? 'Certificate' : 'Certificates'}
                            </span>
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {worker.status === 'Compliant' && (
                            <span className="inline-flex items-center space-x-1.5 bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 text-xs px-3 py-1 rounded-full font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span>Compliant</span>
                            </span>
                          )}
                          {worker.status === 'Warning' && (
                            <span className="inline-flex items-center space-x-1.5 bg-amber-950/80 text-amber-400 border border-amber-800/60 text-xs px-3 py-1 rounded-full font-semibold">
                              <Clock className="w-3.5 h-3.5 shrink-0" />
                              <span>Expires Soon</span>
                            </span>
                          )}
                          {worker.status === 'Expired' && (
                            <span className="inline-flex items-center space-x-1.5 bg-rose-950/80 text-rose-400 border border-rose-800/60 text-xs px-3 py-1 rounded-full font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              <span>Non-Compliant</span>
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-slate-400 whitespace-nowrap">
                          {formatDateString(nextExpiringCert?.expDate)}
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end space-x-3">
                            <button 
                              onClick={() => openEditWorkerModal(worker)}
                              className="inline-flex items-center space-x-1 text-xs font-semibold text-amber-400 hover:text-amber-300 transition cursor-pointer"
                              title="Edit Worker & Certificates"
                            >
                              <Pencil className="w-3.5 h-3.5 shrink-0" />
                              <span>Edit</span>
                            </button>

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
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Modal: Edit Worker & Certificates */}
        {workerToEdit && (
          <div
            onPaste={handleEditPaste}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          >
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 max-w-lg w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
              <header className="flex justify-between items-center mb-4">
                <div className="flex items-center space-x-2 text-amber-400">
                  <Pencil className="w-4 h-4 shrink-0" />
                  <h3 className="text-base sm:text-lg font-bold text-white">Edit Worker &amp; Certificates</h3>
                </div>
                <button 
                  onClick={() => setWorkerToEdit(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </header>

              {editFormError && (
                <div className="mb-4 p-3 bg-red-950/50 border border-red-800 text-red-300 text-xs rounded-xl flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{editFormError}</span>
                </div>
              )}

              <form onSubmit={handleUpdateWorker} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Worker Full Name
                  </label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Marcus Vance"
                    value={editWorkerName}
                    onChange={(e) => setEditWorkerName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Trade Specialty
                    </label>
                    <select
                      value={editWorkerTrade}
                      onChange={(e) => setEditWorkerTrade(e.target.value)}
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
                      value={editWorkerRole}
                      onChange={(e) => setEditWorkerRole(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Multiple Certificates Section */}
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Certificates &amp; Credentials ({editCertificates.length})
                    </span>
                    <button
                      type="button"
                      onClick={handleEditCertificateRow}
                      className="inline-flex items-center space-x-1 text-xs font-semibold text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/30 px-2.5 py-1 rounded-lg transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Certificate</span>
                    </button>
                  </div>

                  {editCertificates.map((cert, idx) => {
                    const safeCertUrl = getSafeCertificateUrl(cert.fileUrl);
                    const isFocused = activeEditCertIndex === idx;

                    return (
                      <div
                        key={cert.id}
                        onClick={() => setActiveEditCertIndex(idx)}
                        className={`p-3.5 rounded-xl border bg-slate-950/70 space-y-3 transition ${
                          isFocused ? 'border-blue-500/60' : 'border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-300">
                            Certificate #{idx + 1}
                          </span>
                          {editCertificates.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveEditCertificateRow(idx);
                              }}
                              className="inline-flex items-center space-x-1 text-[11px] font-semibold text-rose-400 hover:text-rose-300 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Remove</span>
                            </button>
                          )}
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                            Certificate Type / Name
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. OSHA 30, Trade License, Insurance Binder"
                            value={cert.label}
                            onChange={(e) =>
                              updateEditCertificateField(idx, { label: e.target.value })
                            }
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                              Credential / Policy Number
                            </label>
                            <input
                              type="text"
                              placeholder="e.g. OSHA-30-99482"
                              value={cert.certNumber || ''}
                              onChange={(e) =>
                                updateEditCertificateField(idx, { certNumber: e.target.value })
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                              Expiration Date
                            </label>
                            <input
                              type="date"
                              value={cert.expDate || ''}
                              onChange={(e) =>
                                updateEditCertificateField(idx, { expDate: e.target.value })
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white [color-scheme:dark] focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                            Screenshot (Click card &amp; Ctrl+V, or select image)
                          </label>
                          <label className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-3 text-center cursor-pointer transition bg-slate-950/50 flex flex-col items-center justify-center">
                            <Upload className="w-5 h-5 text-slate-400 mb-1" />
                            <span className="text-xs text-slate-300 font-medium truncate max-w-full px-2">
                              {cert.fileName
                                ? `Attached: ${cert.fileName}`
                                : 'Paste screenshot (Ctrl+V) or select image'}
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  handleEditImageSelect(idx, e.target.files[0]);
                                }
                              }}
                            />
                          </label>

                          {safeCertUrl && isImageCertificate(safeCertUrl) && (
                            <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950 p-2 space-y-1.5">
                              <div className="flex items-center justify-between text-[11px] text-slate-400">
                                <span>Preview</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateEditCertificateField(idx, {
                                      fileName: null,
                                      fileUrl: null,
                                    })
                                  }
                                  className="text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                                >
                                  Remove Image
                                </button>
                              </div>
                              <img
                                src={safeCertUrl}
                                alt={cert.label || 'Certificate preview'}
                                className="max-h-32 w-full rounded-lg object-contain bg-slate-900"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex space-x-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setWorkerToEdit(null)}
                    className="w-1/2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2.5 rounded-xl text-xs transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={updatingWorker}
                    className="w-1/2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-xs transition disabled:opacity-50 shadow-lg shadow-blue-600/20 cursor-pointer"
                  >
                    {updatingWorker ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Worker Details Breakdown */}
        {workerDetailsModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 max-w-lg w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2 text-blue-400">
                  <FileCheck className="w-5 h-5 shrink-0" />
                  <h3 className="text-base sm:text-lg font-bold text-white truncate">Worker Certification Details</h3>
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
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">Full Name</span>
                      <span className="text-base font-bold text-white">{workerDetailsModal.name}</span>
                    </div>
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                        workerDetailsModal.status === 'Compliant'
                          ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60'
                          : workerDetailsModal.status === 'Warning'
                          ? 'bg-amber-950/80 text-amber-400 border-amber-800/60'
                          : 'bg-rose-950/80 text-rose-400 border-rose-800/60'
                      }`}
                    >
                      {workerDetailsModal.status}
                    </span>
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
                </div>

                {/* Itemized Certificates List */}
                <div className="space-y-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                    Certificates on File ({(workerDetailsModal.certificates || []).length})
                  </span>

                  {(workerDetailsModal.certificates || []).length === 0 ? (
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs text-slate-400">
                      No certificates attached to this worker profile yet.
                    </div>
                  ) : (
                    (workerDetailsModal.certificates || []).map((cert, idx) => {
                      const certStatus = getComplianceStatus(cert.expDate, activeTimeZone);
                      const safeCertUrl = getSafeCertificateUrl(cert.fileUrl);

                      return (
                        <div
                          key={cert.id || idx}
                          className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-white text-sm">
                              {cert.label || `Certificate #${idx + 1}`}
                            </span>
                            <span
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                                certStatus === 'Compliant'
                                  ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60'
                                  : certStatus === 'Warning'
                                  ? 'bg-amber-950/80 text-amber-400 border-amber-800/60'
                                  : 'bg-rose-950/80 text-rose-400 border-rose-800/60'
                              }`}
                            >
                              {certStatus === 'Expired' ? 'Expired' : certStatus}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <span className="text-[11px] uppercase tracking-wider text-slate-500 block">
                                Credential / Policy #
                              </span>
                              <span className="font-mono text-slate-200">
                                {cert.certNumber || 'N/A'}
                              </span>
                            </div>
                            <div>
                              <span className="text-[11px] uppercase tracking-wider text-slate-500 block">
                                Expiration Date
                              </span>
                              <span className="text-slate-200">
                                {formatDateString(cert.expDate)}
                              </span>
                            </div>
                          </div>

                          {safeCertUrl ? (
                            <div className="pt-2 border-t border-slate-800/80 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-slate-300 flex items-center space-x-1.5 min-w-0">
                                  <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                  <span className="truncate">{cert.fileName || 'Certificate Document'}</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openCertificateInNewTab(safeCertUrl)}
                                  className="inline-flex items-center space-x-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-2.5 py-1 rounded-lg transition shrink-0 cursor-pointer"
                                >
                                  <span>View</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </button>
                              </div>

                              {isImageCertificate(safeCertUrl) && (
                                <img
                                  src={safeCertUrl}
                                  alt={cert.label || 'Certificate'}
                                  className="max-h-40 w-full rounded-lg border border-slate-800 bg-slate-900 object-contain"
                                />
                              )}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-500 pt-1">
                              No screenshot attached
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-6 flex space-x-3">
                <button
                  onClick={() => openEditWorkerModal(workerDetailsModal)}
                  className="w-1/2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl text-xs transition cursor-pointer flex items-center justify-center space-x-1.5"
                >
                  <Pencil className="w-3.5 h-3.5 shrink-0" />
                  <span>Edit Certificates</span>
                </button>
                <button
                  onClick={() => setWorkerDetailsModal(null)}
                  className="w-1/2 bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2.5 rounded-xl text-xs transition cursor-pointer"
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
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 max-w-md w-full mx-4 shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center space-x-2 text-rose-500">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <h3 className="text-base sm:text-lg font-bold text-white">Delete Worker Profile?</h3>
                </div>
                <button 
                  onClick={() => setWorkerToDelete(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm text-slate-300 mb-6 leading-relaxed">
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
          <div
            onPaste={handleAddPaste}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          >
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 max-w-lg w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
              <header className="flex justify-between items-center mb-4">
                <h3 className="text-base sm:text-lg font-bold text-white">Add Crew Worker Profile</h3>
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                </div>

                {/* Multiple Certificates Section */}
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Certificates &amp; Credentials ({addCertificates.length})
                    </span>
                    <button
                      type="button"
                      onClick={handleAddCertificateRow}
                      className="inline-flex items-center space-x-1 text-xs font-semibold text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/30 px-2.5 py-1 rounded-lg transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Certificate</span>
                    </button>
                  </div>

                  {addCertificates.map((cert, idx) => {
                    const safeCertUrl = getSafeCertificateUrl(cert.fileUrl);
                    const isFocused = activeAddCertIndex === idx;

                    return (
                      <div
                        key={cert.id}
                        onClick={() => setActiveAddCertIndex(idx)}
                        className={`p-3.5 rounded-xl border bg-slate-950/70 space-y-3 transition ${
                          isFocused ? 'border-blue-500/60' : 'border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-300">
                            Certificate #{idx + 1}
                          </span>
                          {addCertificates.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveAddCertificateRow(idx);
                              }}
                              className="inline-flex items-center space-x-1 text-[11px] font-semibold text-rose-400 hover:text-rose-300 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Remove</span>
                            </button>
                          )}
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                            Certificate Type / Name
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. OSHA 30, Trade License, Insurance Binder"
                            value={cert.label}
                            onChange={(e) =>
                              updateAddCertificateField(idx, { label: e.target.value })
                            }
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                              Credential / Policy Number
                            </label>
                            <input
                              type="text"
                              placeholder="e.g. OSHA-30-99482"
                              value={cert.certNumber || ''}
                              onChange={(e) =>
                                updateAddCertificateField(idx, { certNumber: e.target.value })
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                              Expiration Date
                            </label>
                            <input
                              type="date"
                              value={cert.expDate || ''}
                              onChange={(e) =>
                                updateAddCertificateField(idx, { expDate: e.target.value })
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white [color-scheme:dark] focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                            Screenshot (Click card &amp; Ctrl+V, or select image)
                          </label>
                          <label className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-3 text-center cursor-pointer transition bg-slate-950/50 flex flex-col items-center justify-center">
                            <Upload className="w-5 h-5 text-slate-400 mb-1" />
                            <span className="text-xs text-slate-300 font-medium truncate max-w-full px-2">
                              {cert.fileName
                                ? `Attached: ${cert.fileName}`
                                : 'Paste screenshot (Ctrl+V) or select image'}
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  handleAddImageSelect(idx, e.target.files[0]);
                                }
                              }}
                            />
                          </label>

                          {safeCertUrl && isImageCertificate(safeCertUrl) && (
                            <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950 p-2 space-y-1.5">
                              <div className="flex items-center justify-between text-[11px] text-slate-400">
                                <span>Preview</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateAddCertificateField(idx, {
                                      fileName: null,
                                      fileUrl: null,
                                    })
                                  }
                                  className="text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                                >
                                  Remove Image
                                </button>
                              </div>
                              <img
                                src={safeCertUrl}
                                alt={cert.label || 'Certificate preview'}
                                className="max-h-32 w-full rounded-lg object-contain bg-slate-900"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 max-w-md w-full mx-4 shadow-2xl">
              <header className="flex justify-between items-center mb-4">
                <h3 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
                  <UserCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                  <span>Multiple Foreman Accounts</span>
                </h3>
                <button 
                  onClick={() => setShowForemanModal(false)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </header>

              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Enterprise plan allows authorized field foremen to log in, view worker compliance status and certificates, and receive automated expiration alerts.
              </p>

              <form onSubmit={handleAddForeman} className="flex gap-2 mb-4">
                <input 
                  type="email" 
                  required
                  placeholder="foreman@company.com"
                  value={newForemanEmail}
                  onChange={(e) => setNewForemanEmail(e.target.value)}
                  className="flex-grow bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 min-w-0"
                />
                <button 
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-2 rounded-xl text-xs transition cursor-pointer whitespace-nowrap"
                >
                  Add
                </button>
              </form>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {(!profile?.foremanEmails || profile.foremanEmails.length === 0) ? (
                  <p className="text-xs text-slate-500 text-center py-4">No secondary foreman emails added yet.</p>
                ) : (
                  profile.foremanEmails.map((email) => (
                    <div key={email} className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 gap-2">
                      <span className="truncate">{email}</span>
                      <button 
                        onClick={() => handleRemoveForeman(email)}
                        className="text-slate-500 hover:text-rose-400 transition cursor-pointer shrink-0"
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
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 max-w-md w-full mx-4 shadow-2xl">
              <header className="flex justify-between items-center mb-4">
                <h3 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
                  <Palette className="w-5 h-5 text-sky-400 shrink-0" />
                  <span>Custom Company Branding</span>
                </h3>
                <button 
                  onClick={() => setShowBrandingModal(false)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </header>

              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Custom logo &amp; color scheme appear on your TradePass dashboard header and public GC passport links.
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
                      className="w-10 h-10 rounded-lg bg-transparent cursor-pointer border-0 shrink-0"
                    />
                    <input 
                      type="text" 
                      value={brandingColor}
                      onChange={(e) => setBrandingColor(e.target.value)}
                      className="flex-grow bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500 min-w-0"
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