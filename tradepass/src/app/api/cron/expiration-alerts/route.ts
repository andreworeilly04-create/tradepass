import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase'; // Uses your standard client config
import { collection, getDocs } from 'firebase/firestore';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function GET(req: Request) {
  // 1. Authenticate the Cron request using your secret key
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = new Date();
    
    // Fetch all user accounts from Firestore client SDK
    const usersSnap = await getDocs(collection(db, 'users'));
    let totalEmailsSent = 0;

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const userEmail = userData.email;
      const companyName = userData.companyName || 'Your Crew';

      if (!userEmail) continue;

      // Fetch workers subcollection for this user
      const workersSnap = await getDocs(collection(db, 'users', userDoc.id, 'workers'));

      const expiringWorkers: Array<{
        name: string;
        certNumber: string;
        expDate: string;
        daysRemaining: number;
      }> = [];

      workersSnap.forEach((workerDoc) => {
        const worker = workerDoc.data();
        if (worker.oshaExpDate) {
          const expDate = new Date(worker.oshaExpDate);
          const diffDays = Math.ceil(
            (expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Alert for items expiring in <= 30 days (and up to 30 days past due)
          if (diffDays <= 30 && diffDays >= -30) {
            expiringWorkers.push({
              name: worker.name,
              certNumber: worker.oshaCertNumber || 'N/A',
              expDate: worker.oshaExpDate,
              daysRemaining: diffDays,
            });
          }
        }
      });

      // 2. Send email digest if action is required
      if (expiringWorkers.length > 0) {
        const workerListRows = expiringWorkers
          .map(
            (w) => `
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #1e293b; color: #ffffff; font-weight: 600;">${w.name}</td>
              <td style="padding: 12px; border-bottom: 1px solid #1e293b; color: #94a3b8;">${w.certNumber}</td>
              <td style="padding: 12px; border-bottom: 1px solid #1e293b; color: ${w.daysRemaining < 0 ? '#f43f5e' : '#fbbf24'}; font-weight: 600;">
                ${w.daysRemaining < 0 ? `EXPIRED (${Math.abs(w.daysRemaining)} days ago)` : `Expires in ${w.daysRemaining} days`}
              </td>
            </tr>`
          )
          .join('');

        await resend.emails.send({
          from: 'TradePass Alerts <onboarding@resend.dev>',
          to: [userEmail],
          subject: `⚠️ Action Required: ${expiringWorkers.length} Worker Credentials Expiring Soon`,
          html: `
            <div style="background-color: #020617; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px; color: #e2e8f0; max-width: 600px; margin: 0 auto; border-radius: 16px; border: 1px solid #1e293b;">
              <h2 style="color: #ffffff; font-size: 20px; font-weight: 800; margin-bottom: 6px;">TradePass Expiration Warning</h2>
              <p style="color: #94a3b8; font-size: 14px; margin-top: 0; line-height: 1.5;">
                Attention <strong>${companyName}</strong>: The following worker certifications require renewal to maintain site clearance.
              </p>
              
              <table style="width: 100%; border-collapse: collapse; margin: 24px 0; text-align: left; font-size: 13px;">
                <thead>
                  <tr style="color: #64748b; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; border-bottom: 1px solid #334155;">
                    <th style="padding: 8px 12px;">Worker</th>
                    <th style="padding: 8px 12px;">OSHA #</th>
                    <th style="padding: 8px 12px;">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${workerListRows}
                </tbody>
              </table>

              <div style="margin-top: 28px; text-align: center;">
                <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/dashboard" 
                   style="background-color: #10b981; color: #020617; padding: 12px 28px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 14px; display: inline-block;">
                   Update Crew Credentials
                </a>
              </div>
            </div>
          `,
        });

        totalEmailsSent++;
      }
    }

    return NextResponse.json({ success: true, emailsSent: totalEmailsSent });
  } catch (error: any) {
    console.error('Expiration Cron Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}