import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  'TradePass Compliance <onboarding@resend.dev>';

function parseLocalDate(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    return new Date(year, month, day, 0, 0, 0, 0);
  }

  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
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

  // Multi / Enterprise: 30, 15, 7, and 1-day final urgent alert
  if (tier.includes('multi') || tier.includes('enterprise')) {
    return [30, 15, 7, 1];
  }

  // Crew Pro: 30, 15, and 7-day automated reminders
  if (tier.includes('pro')) {
    return [30, 15, 7];
  }

  // Standard / Standard Crew: 30 and 15-day automated reminders
  return [30, 15];
}

export async function GET(request: Request) {
  // 1. Verify Vercel Cron Secret Header
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const usersSnapshot = await adminDb.collection('users').get();
    let emailsSent = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;
      const userEmail = userData.email;
      const companyName = userData.companyName || 'Your Company';
      const allowedMilestones = getAllowedMilestones(userData);
      const hasPublicPassport = allowedMilestones.includes(7);

      if (!userEmail) continue;

      const workersSnapshot = await adminDb
        .collection('users')
        .doc(userId)
        .collection('workers')
        .get();

      const expiringWorkers30Days: any[] = [];
      const expiringWorkers15Days: any[] = [];
      const expiringWorkers7Days: any[] = [];
      const expiringWorkers1Day: any[] = [];

      workersSnapshot.forEach((workerDoc) => {
        const worker = workerDoc.data();
        if (!worker.oshaExpDate) return;

        const expDate = parseLocalDate(String(worker.oshaExpDate));
        if (!expDate) return;

        const diffTime = expDate.getTime() - today.getTime();
        const daysRemaining = Math.round(diffTime / (1000 * 60 * 60 * 24));

        if (!allowedMilestones.includes(daysRemaining)) return;

        const item = {
          name: worker.name,
          cardType: worker.cardType || 'OSHA Certification',
          expDate: worker.oshaExpDate,
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
        workers: any[],
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

      // Dispatch milestone emails based on tier access
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