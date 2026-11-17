import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16' as any,
});

// Helper to resolve priceId to tier name & worker limits
function getTierDetails(priceId: string) {
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID) {
    return { planTier: 'Standard Crew', maxWorkers: 10 };
  }
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID) {
    return { planTier: 'Crew Pro', maxWorkers: 25 };
  }
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID) {
    return { planTier: 'Multi-Crew Enterprise', maxWorkers: 999 };
  }
  return null;
}

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    const bodyText = await req.text();
    event = stripe.webhooks.constructEvent(
      bodyText,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subField = (invoice as any)?.subscription;
        const subscriptionId = typeof subField === 'string' 
          ? subField 
          : subField && typeof subField === 'object' && 'id' in subField 
            ? (subField as any).id 
            : null;

        if (!subscriptionId) break;

        // Retrieve subscription to get the latest active price ID
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price.id;
        const tierInfo = priceId ? getTierDetails(priceId) : null;

        const usersSnapshot = await db.collection('users').where('subscriptionId', '==', subscriptionId).get();

        if (!usersSnapshot.empty) {
          const batch = db.batch();
          usersSnapshot.docs.forEach((userDoc) => {
            const updateData: any = {
              subscriptionStatus: 'active',
              subscriptionId: subscription.id,
              cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
              updatedAt: FieldValue.serverTimestamp(),
            };

            // If a valid tier was found from the paid invoice price, sync it!
            if (tierInfo) {
              updateData.planTier = tierInfo.planTier;
              updateData.maxWorkers = tierInfo.maxWorkers;
            }

            batch.update(userDoc.ref, updateData);
          });
          await batch.commit();
          console.log(`Successfully activated & synchronized subscription for sub ID: ${subscriptionId}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription?.id;
        const status = subscription?.status;

        if (!subscriptionId || !status) break;

        // Ignore incomplete states so abandoned checkouts do not grant paid access
        if (status === 'incomplete' || status === 'incomplete_expired') {
          console.log(`Skipping status update for incomplete subscription: ${subscriptionId}`);
          break;
        }

        const priceId = subscription.items.data[0]?.price.id;
        const tierInfo = priceId ? getTierDetails(priceId) : null;

        const usersSnapshot = await db.collection('users').where('subscriptionId', '==', subscriptionId).get();

        if (!usersSnapshot.empty) {
          const batch = db.batch();
          usersSnapshot.docs.forEach((userDoc) => {
            const updateData: any = {
              subscriptionStatus: status,
              cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
              updatedAt: FieldValue.serverTimestamp(),
            };

            // Dynamically update tier & limits if price changed (e.g. instant downgrade or confirmed upgrade)
            if (tierInfo) {
              updateData.planTier = tierInfo.planTier;
              updateData.maxWorkers = tierInfo.maxWorkers;
            }

            batch.update(userDoc.ref, updateData);
          });
          await batch.commit();
          console.log(`Updated subscription ${subscriptionId} status to: ${status} with tier info.`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription?.id;

        if (!subscriptionId) break;

        const usersSnapshot = await db.collection('users').where('subscriptionId', '==', subscriptionId).get();

        if (!usersSnapshot.empty) {
          const batch = db.batch();
          usersSnapshot.docs.forEach((userDoc) => {
            batch.update(userDoc.ref, {
              subscriptionStatus: 'canceled',
              cancelAtPeriodEnd: false,
              updatedAt: FieldValue.serverTimestamp(),
            });
          });
          await batch.commit();
          console.log(`Marked subscription ${subscriptionId} as canceled.`);
        }
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
  } catch (dbErr: any) {
    console.error('Firebase Admin Webhook Error:', dbErr);
    return NextResponse.json({ error: `Database update failed: ${dbErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}