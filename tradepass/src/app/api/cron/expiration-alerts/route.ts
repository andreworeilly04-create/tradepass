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

function isStandardTier(userData: FirebaseFirestore.DocumentData): boolean {
  const tier = (
    userData.planTier ||
    userData.subscriptionTier ||
    'Standard Crew'
  )
    .toString()
    .toLowerCase();

  return tier === 'standard' || tier === 'standard crew';
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
      const standardOnly = isStandardTier(userData);

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

        const item = {
          name: worker.name,
          cardType: worker.cardType || 'OSHA Certification',
          expDate: worker.oshaExpDate,
        };

        if (daysRemaining === 30) expiringWorkers30Days.push(item);
        if (daysRemaining === 15) expiringWorkers15Days.push(item);

        // 7-day and 1-day milestones reserved for Pro and Enterprise tiers
        if (!standardOnly) {
          if (daysRemaining === 7) expiringWorkers7Days.push(item);
          if (daysRemaining === 1) expiringWorkers1Day.push(item);
        }
      });

      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || 'https://tradepass-nine.vercel.app';
      const passportUrl = `${appUrl}/passport/${userId}`;

      const sendAlertEmail = async (
        workers: any[],
        timeframeText: string,
        urgencyBadge: string
      ) => {
        const listHtml = workers
          .map(
            (w) =>
              `<li style="margin-bottom: 6px;"><strong>${w.name}</strong> - ${w.cardType} (Expires: ${w.expDate})</li>`
          )
          .join('');

        const { error } = await resend.emails.send({
          from: FROM_EMAIL,
          to: userEmail,
          subject: `${urgencyBadge} ${workers.length} worker credential(s) expiring in ${timeframeText}`,
          html: `
            <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <h2 style="color: #1e293b; margin-top: 0;">TradePass Compliance Alert</h2>
              <p>Hello <strong>${companyName}</strong>,</p>
              <p>You have worker certifications that reach expiration in <strong>${timeframeText}</strong>:</p>
              <ul style="background-color: #f8fafc; padding: 16px 24px; border-radius: 6px; border: 1px solid #cbd5e1;">
                ${listHtml}
              </ul>
              <p style="margin-top: 24px;">
                <a href="${passportUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                  View & Update Live GC Passport
                </a>
              </p>
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
          '[NOTICE - 30 DAYS]'
        );
      }
      if (expiringWorkers15Days.length > 0) {
        await sendAlertEmail(
          expiringWorkers15Days,
          '15 days',
          '[WARNING - 15 DAYS]'
        );
      }
      if (!standardOnly) {
        if (expiringWorkers7Days.length > 0) {
          await sendAlertEmail(
            expiringWorkers7Days,
            '7 days',
            '[ACTION REQUIRED - 7 DAYS]'
          );
        }
        if (expiringWorkers1Day.length > 0) {
          await sendAlertEmail(
            expiringWorkers1Day,
            '24 HOURS',
            '[URGENT - 1 DAY]'
          );
        }
      }
    }

    return NextResponse.json({ success: true, emailsSent });
  } catch (error: any) {
    console.error('Cron job error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}