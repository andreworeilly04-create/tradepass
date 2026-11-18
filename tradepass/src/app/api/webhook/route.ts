import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

// Initialize Stripe with the modern webhook version
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-10-28.endive' as any,
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Helper function to map Stripe price IDs to your app's tier details
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
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      // 1. PAYMENT SUCCEEDED: The exclusive trigger that assigns paid tiers safely
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice as any;
        const subscriptionId = invoice.subscription as string;
        const customerId = invoice.customer as string;

        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price.id;
        const tierInfo = priceId ? getTierDetails(priceId) : null;

        // Find user by subscriptionId
        let usersSnapshot = await adminDb
          .collection('users')
          .where('subscriptionId', '==', subscriptionId)
          .get();

        if (usersSnapshot.empty && customerId) {
          // Fallback lookup via Stripe customer metadata
          const customer = await stripe.customers.retrieve(customerId);
          if (!customer.deleted && customer.metadata?.firebaseUID) {
            const userDoc = await adminDb.collection('users').doc(customer.metadata.firebaseUID).get();
            if (userDoc.exists) {
              usersSnapshot = { empty: false, docs: [userDoc] } as any;
            }
          }
        }

        if (!usersSnapshot.empty && tierInfo) {
          const batch = adminDb.batch();
          usersSnapshot.docs.forEach((userDoc) => {
            batch.update(userDoc.ref, {
              planTier: tierInfo.planTier,
              maxWorkers: tierInfo.maxWorkers,
              subscriptionId: subscriptionId,
              subscriptionStatus: 'active',
              cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
              updatedAt: FieldValue.serverTimestamp(),
            });
          });
          await batch.commit();
          console.log(`Successfully upgraded user tier on payment success for subscription: ${subscriptionId}`);
        }
        break;
      }

      // 2. SUBSCRIPTION UPDATED: Manages statuses gracefully without blocking incomplete checkouts
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription?.id;
        const status = subscription?.status;

        if (!subscriptionId || !status) break;

        const usersSnapshot = await adminDb
          .collection('users')
          .where('subscriptionId', '==', subscriptionId)
          .get();

        if (!usersSnapshot.empty) {
          const batch = adminDb.batch();
          usersSnapshot.docs.forEach((userDoc) => {
            // Allow tracking status changes (including incomplete during active checkout flow)
            // but preserve active tier security until payment_succeeded fires.
            const updateData: any = {
              subscriptionStatus: status,
              cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
              updatedAt: FieldValue.serverTimestamp(),
            };

            batch.update(userDoc.ref, updateData);
          });
          await batch.commit();
          console.log(`Updated subscription ${subscriptionId} status to: ${status}`);
        }
        break;
      }

      // 3. SUBSCRIPTION DELETED / CANCELED
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription?.id;

        if (!subscriptionId) break;

        const usersSnapshot = await adminDb
          .collection('users')
          .where('subscriptionId', '==', subscriptionId)
          .get();

        if (!usersSnapshot.empty) {
          const batch = adminDb.batch();
          usersSnapshot.docs.forEach((userDoc) => {
            batch.update(userDoc.ref, {
              subscriptionStatus: 'canceled',
              planTier: 'Free',
              maxWorkers: 3,
              updatedAt: FieldValue.serverTimestamp(),
            });
          });
          await batch.commit();
          console.log(`Processed cancellation for subscription: ${subscriptionId}`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err: any) {
    console.error(`Webhook processing error for ${event.type}:`, err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}