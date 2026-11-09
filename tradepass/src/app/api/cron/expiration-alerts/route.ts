import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(request: Request) {
  // 1. Verify Vercel Cron Secret Header
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    let emailsSent = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;
      const userEmail = userData.email;
      const companyName = userData.companyName || 'Your Company';
      const userTier = userData.subscriptionTier || 'standard'; // Default to standard tier

      if (!userEmail) continue;

      const workersSnapshot = await getDocs(collection(db, `users/${userId}/workers`));
      
      const expiringWorkers30Days: any[] = [];
      const expiringWorkers15Days: any[] = [];
      const expiringWorkers7Days: any[] = [];
      const expiringWorkers1Day: any[] = [];

      workersSnapshot.forEach((workerDoc) => {
        const worker = workerDoc.data();
        if (!worker.oshaExpDate) return;

        const expDate = new Date(worker.oshaExpDate);
        expDate.setHours(0, 0, 0, 0);

        const diffTime = expDate.getTime() - today.getTime();
        const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        const item = {
          name: worker.name,
          cardType: worker.cardType || 'OSHA Certification',
          expDate: worker.oshaExpDate,
        };

        if (daysRemaining === 30) expiringWorkers30Days.push(item);
        if (daysRemaining === 15) expiringWorkers15Days.push(item);
        
        // 7-day and 1-day milestones reserved for Pro and Enterprise tiers
        if (userTier !== 'standard') {
          if (daysRemaining === 7) expiringWorkers7Days.push(item);
          if (daysRemaining === 1) expiringWorkers1Day.push(item);
        }
      });

      const passportUrl = `${process.env.NEXT_PUBLIC_APP_URL}/passport/${userId}`;

      const sendAlertEmail = async (workers: any[], timeframeText: string, urgencyBadge: string) => {
        const listHtml = workers
          .map(w => `<li style="margin-bottom: 6px;"><strong>${w.name}</strong> - ${w.cardType} (Expires: ${w.expDate})</li>`)
          .join('');

        await resend.emails.send({
          from: 'TradePass Compliance <compliance@tradepass.com>',
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
        emailsSent++;
      };

      // Dispatch milestone emails based on tier access
      if (expiringWorkers30Days.length > 0) {
        await sendAlertEmail(expiringWorkers30Days, '30 days', '[NOTICE - 30 DAYS]');
      }
      if (expiringWorkers15Days.length > 0) {
        await sendAlertEmail(expiringWorkers15Days, '15 days', '[WARNING - 15 DAYS]');
      }
      if (userTier !== 'standard') {
        if (expiringWorkers7Days.length > 0) {
          await sendAlertEmail(expiringWorkers7Days, '7 days', '[ACTION REQUIRED - 7 DAYS]');
        }
        if (expiringWorkers1Day.length > 0) {
          await sendAlertEmail(expiringWorkers1Day, '24 HOURS', '[URGENT - 1 DAY]');
        }
      }
    }

    return NextResponse.json({ success: true, emailsSent });
  } catch (error: any) {
    console.error('Cron job error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}