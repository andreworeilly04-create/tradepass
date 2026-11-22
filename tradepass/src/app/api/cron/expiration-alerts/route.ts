import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  'TradePass Compliance <onboarding@resend.dev>';

const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'America/New_York';

function getSafeTimeZone(userData: FirebaseFirestore.DocumentData): string {
  const candidate =
    typeof userData.timeZone === 'string' && userData.timeZone.trim()
      ? userData.timeZone.trim()
      : typeof userData.timezone === 'string' && userData.timezone.trim()
      ? userData.timezone.trim()
      : DEFAULT_TIMEZONE;

  try {
    Intl.DateTimeFormat(undefined, { timeZone: candidate });
    return candidate;
  } catch {
    return 'America/New_York';
  }
}

function getStartOfDayInTimeZone(date: Date, timeZone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
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

function normalizeDateInput(raw: unknown): string | Date | null {
  if (!raw) return null;
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'toDate' in raw &&
    typeof (raw as { toDate?: unknown }).toDate === 'function'
  ) {
    return (raw as { toDate: () => Date }).toDate();
  }
  if (raw instanceof Date || typeof raw === 'string') {
    return raw;
  }
  return String(raw);
}

function parseLocalDate(rawInput: unknown, timeZone: string): Date | null {
  const normalized = normalizeDateInput(rawInput);
  if (!normalized) return null;

  if (normalized instanceof Date) {
    if (Number.isNaN(normalized.getTime())) return null;
    // If stored as a Date/Timestamp, extract calendar day in the user's timezone
    return getStartOfDayInTimeZone(normalized, timeZone);
  }

  const trimmed = normalized.trim();
  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoDateMatch) {
    const year = Number(isoDateMatch[1]);
    const month = Number(isoDateMatch[2]) - 1;
    const day = Number(isoDateMatch[3]);
    return new Date(year, month, day, 0, 0, 0, 0);
  }

  const slashDateMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashDateMatch) {
    const month = Number(slashDateMatch[1]) - 1;
    const day = Number(slashDateMatch[2]);
    const year = Number(slashDateMatch[3]);
    return new Date(year, month, day, 0, 0, 0, 0);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return getStartOfDayInTimeZone(parsed, timeZone);
}

function getAllowedMilestones(userData: FirebaseFirestore.DocumentData): number[] {
  const tier = (
    userData.planTier ||
    userData.subscriptionTier ||
    'Standard Crew'
  )
    .toString()
    .toLowerCase()
    .trim();

  if (tier.includes('multi') || tier.includes('enterprise')) {
    return [30, 15, 7, 1];
  }

  if (tier.includes('pro')) {
    return [30, 15, 7];
  }

  return [30, 15];
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const usersSnapshot = await adminDb.collection('users').get();
    let emailsSent = 0;

    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;
      const userEmail = userData.email;
      const companyName = userData.companyName || 'Your Company';
      const userTimeZone = getSafeTimeZone(userData);
      const today = getStartOfDayInTimeZone(now, userTimeZone);
      const allowedMilestones = getAllowedMilestones(userData);
      const hasPublicPassport = allowedMilestones.includes(7);

      if (!userEmail) continue;

      const workersSnapshot = await adminDb
        .collection('users')
        .doc(userId)
        .collection('workers')
        .get();

      const expiringWorkers30Days: Array<{
        name: string;
        cardType: string;
        expDate: string;
      }> = [];
      const expiringWorkers15Days: Array<{
        name: string;
        cardType: string;
        expDate: string;
      }> = [];
      const expiringWorkers7Days: Array<{
        name: string;
        cardType: string;
        expDate: string;
      }> = [];
      const expiringWorkers1Day: Array<{
        name: string;
        cardType: string;
        expDate: string;
      }> = [];

      workersSnapshot.forEach((workerDoc) => {
        const worker = workerDoc.data();
        if (!worker.oshaExpDate) return;

        const expDate = parseLocalDate(worker.oshaExpDate, userTimeZone);
        if (!expDate) return;

        const diffTime = expDate.getTime() - today.getTime();
        const daysRemaining = Math.round(diffTime / msPerDay);

        if (!allowedMilestones.includes(daysRemaining)) return;

        const item = {
          name: worker.name,
          cardType: worker.cardType || 'OSHA Certification',
          expDate: String(worker.oshaExpDate),
        };

        if (daysRemaining === 30) expiringWorkers30Days.push(item);
        if (daysRemaining === 15) expiringWorkers15Days.push(item);
        if (daysRemaining === 7) expiringWorkers7Days.push(item);
        if (daysRemaining === 1) expiringWorkers1Day.push(item);
      });

      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || 'https://tradepass-nine.vercel.app';
      const dashboardUrl = `${appUrl}/dashboard`;
      const passportUrl = `${appUrl}/passport/${userId}`;

      const sendAlertEmail = async (
        workers: Array<{ name: string; cardType: string; expDate: string }>,
        timeframeText: string,
        subjectPrefix: string,
        isUrgent = false
      ) => {
        const listHtml = workers
          .map(
            (w) =>
              `<li style="margin-bottom: 6px;"><strong>${w.name}</strong> - ${w.cardType} (Expires: ${w.expDate})</li>`
          )
          .join('');

        const headingText = isUrgent
          ? 'Urgent: TradePass Expiration Notice'
          : 'TradePass Expiration Reminder';

        const introText = isUrgent
          ? `This is a final reminder that the following worker certification(s) expire in <strong>${timeframeText}</strong>:`
          : `This is an automated reminder that the following worker certification(s) are scheduled to expire in <strong>${timeframeText}</strong>:`;

        const passportFooterHtml = hasPublicPassport
          ? `<p style="margin-top: 10px; font-size: 12px; color: #64748b;">
               Public GC Roster Link (Read-Only): <a href="${passportUrl}" style="color: #2563eb;">${passportUrl}</a>
             </p>`
          : '';

        const { error } = await resend.emails.send({
          from: FROM_EMAIL,
          to: userEmail,
          subject: `${subjectPrefix} ${workers.length} worker credential(s) expiring in ${timeframeText}`,
          html: `
            <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <h2 style="color: #1e293b; margin-top: 0;">${headingText}</h2>
              <p>Hello <strong>${companyName}</strong>,</p>
              <p>${introText}</p>
              <ul style="background-color: #f8fafc; padding: 16px 24px; border-radius: 6px; border: 1px solid #cbd5e1;">
                ${listHtml}
              </ul>
              <p style="margin-top: 20px; font-size: 13px; color: #334155;">
                To update certifications, sign in to <a href="${dashboardUrl}" style="color: #2563eb; font-weight: bold;">${dashboardUrl}</a> using <strong>${userEmail}</strong>.
              </p>
              ${passportFooterHtml}
            </div>
          `,
        });

        if (error) {
          console.error(`Resend error for ${userEmail}:`, error);
          throw new Error(error.message);
        }

        emailsSent++;
      };

      if (expiringWorkers30Days.length > 0) {
        await sendAlertEmail(
          expiringWorkers30Days,
          '30 days',
          '[AUTOMATED NOTICE - 30 DAYS]',
          false
        );
      }
      if (expiringWorkers15Days.length > 0) {
        await sendAlertEmail(
          expiringWorkers15Days,
          '15 days',
          '[AUTOMATED REMINDER - 15 DAYS]',
          false
        );
      }
      if (expiringWorkers7Days.length > 0) {
        await sendAlertEmail(
          expiringWorkers7Days,
          '7 days',
          '[REMINDER - 7 DAYS]',
          false
        );
      }
      if (expiringWorkers1Day.length > 0) {
        await sendAlertEmail(
          expiringWorkers1Day,
          '24 hours',
          '[URGENT - 1 DAY]',
          true
        );
      }
    }

    return NextResponse.json({ success: true, emailsSent });
  } catch (error: any) {
    console.error('Cron job error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}