
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-10-28.endive' as any,
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Map Stripe price IDs to TradePass tiers
function getTierDetails(priceId: string) {
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID) {
    return {
      planTier: 'Standard Crew',
      maxWorkers: 10,
    };
  }

  if (priceId === process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID) {
    return {
      planTier: 'Crew Pro',
      maxWorkers: 25,
    };
  }

  if (priceId === process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID) {
    return {
      planTier: 'Multi-Crew Enterprise',
      maxWorkers: 999,
    };
  }

  return null;
}

// Safely extract a Stripe object ID from either an ID or expanded object.
function getStripeId(value: any): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object' && typeof value.id === 'string') {
    return value.id;
  }

  return null;
}

// Support both older and newer Stripe invoice subscription structures.
function getInvoiceSubscriptionId(invoice: any): string | null {
  return (
    getStripeId(invoice.subscription) ||
    getStripeId(invoice.parent?.subscription_details?.subscription) ||
    null
  );
}

// Find the Firebase user associated with a Stripe subscription.
async function findUserDocuments(
  subscriptionId: string,
  customerId?: string | null,
  metadataUID?: string | null
) {
  let firebaseUID = metadataUID || null;

  // Look up the Firebase UID from Stripe customer metadata if needed.
  if (!firebaseUID && customerId) {
    const customer = await stripe.customers.retrieve(customerId);

    if (!customer.deleted) {
      firebaseUID = customer.metadata?.firebaseUID || null;
    }
  }

  const snapshot = await adminDb
    .collection('users')
    .where('subscriptionId', '==', subscriptionId)
    .get();

  const userDocs = new Map<string, FirebaseFirestore.DocumentReference>();

  snapshot.docs.forEach((userDoc) => {
    userDocs.set(userDoc.id, userDoc.ref);
  });

  // Fallback lookup using Firebase UID.
  if (firebaseUID) {
    const userDoc = await adminDb
      .collection('users')
      .doc(firebaseUID)
      .get();

    if (userDoc.exists) {
      userDocs.set(userDoc.id, userDoc.ref);
    }
  }

  return Array.from(userDocs.values());
}

// Update subscription status without changing the user's paid tier.
async function updateSubscriptionStatus(
  subscriptionId: string,
  status: string,
  cancelAtPeriodEnd: boolean,
  customerId?: string | null,
  metadataUID?: string | null
) {
  const userDocs = await findUserDocuments(
    subscriptionId,
    customerId,
    metadataUID
  );

  if (userDocs.length === 0) {
    console.warn(
      `No Firebase user found for subscription ${subscriptionId}`
    );
    return;
  }

  const batch = adminDb.batch();

  userDocs.forEach((userDoc) => {
    batch.set(
      userDoc,
      {
        subscriptionStatus: status,
        cancelAtPeriodEnd,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  await batch.commit();
}

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  if (!process.env.STRIPE_SECRET_KEY || !webhookSecret) {
    console.error('Stripe webhook environment variables are missing.');

    return NextResponse.json(
      { error: 'Webhook configuration error' },
      { status: 500 }
    );
  }

  let event: Stripe.Event;

  // Verify that the event genuinely came from Stripe.
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret
    );
  } catch (err: any) {
    console.error(
      `Webhook signature verification failed: ${err.message}`
    );

    return NextResponse.json(
      { error: `Webhook Error: ${err.message}` },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {

      // 1. SUCCESSFUL INVOICE PAYMENT
      // Handles both invoice.paid and invoice.payment_succeeded.
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as any;

        const subscriptionId = getInvoiceSubscriptionId(invoice);
        const customerId = getStripeId(invoice.customer);

        if (!subscriptionId) {
          console.log(
            `Invoice ${invoice.id} has no subscription. Skipping.`
          );
          break;
        }

        // Retrieve the latest subscription directly from Stripe.
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);

        // Only grant a paid tier when the subscription is eligible.
        if (
          subscription.status !== 'active' &&
          subscription.status !== 'trialing'
        ) {
          console.log(
            `Subscription ${subscriptionId} is ${subscription.status}. Paid tier not assigned yet.`
          );

          await updateSubscriptionStatus(
            subscriptionId,
            subscription.status,
            subscription.cancel_at_period_end ?? false,
            customerId,
            subscription.metadata?.firebaseUID
          );

          break;
        }

        // Find the matching TradePass price.
        const matchingItem = subscription.items.data.find((item) =>
          getTierDetails(item.price.id)
        );

        const priceId = matchingItem?.price.id;
        const tierInfo = priceId
          ? getTierDetails(priceId)
          : null;

        if (!tierInfo) {
          console.error(
            `No matching TradePass tier found for subscription ${subscriptionId}.`
          );
          break;
        }

        // Retrieve Stripe customer information.
        let stripeCompanyName: string | null = null;
        let customerUID: string | null = null;

        const actualCustomerId =
          customerId || getStripeId(subscription.customer);

        if (actualCustomerId) {
          const customer =
            await stripe.customers.retrieve(actualCustomerId);

          if (!customer.deleted) {
            stripeCompanyName =
              customer.name ||
              customer.metadata?.companyName ||
              null;

            customerUID =
              customer.metadata?.firebaseUID || null;
          }
        }

        // Find Firebase user documents.
        const userDocs = await findUserDocuments(
          subscriptionId,
          actualCustomerId,
          subscription.metadata?.firebaseUID || customerUID
        );

        if (userDocs.length === 0) {
          throw new Error(
            `No Firebase user found for subscription ${subscriptionId}.`
          );
        }

        // Assign the paid tier after successful payment.
        const batch = adminDb.batch();

        for (const userDoc of userDocs) {
          const existingDoc = await userDoc.get();
          const existingData = existingDoc.data();

          const existingCompanyName =
            existingData?.companyName;

          const companyName =
            existingCompanyName &&
            existingCompanyName !== 'my company'
              ? existingCompanyName
              : stripeCompanyName ||
                existingCompanyName ||
                'My Company';

          batch.set(
            userDoc,
            {
              planTier: tierInfo.planTier,
              maxWorkers: tierInfo.maxWorkers,
              subscriptionId,
              subscriptionStatus: subscription.status,
              companyName,
              cancelAtPeriodEnd:
                subscription.cancel_at_period_end ?? false,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }

        await batch.commit();

        console.log(
          `Successfully activated ${tierInfo.planTier} for subscription ${subscriptionId}.`
        );

        break;
      }

      // 2. SUBSCRIPTION UPDATED
      case 'customer.subscription.updated': {
        const eventSubscription =
          event.data.object as Stripe.Subscription;

        const subscriptionId = eventSubscription.id;

        // Retrieve current status instead of relying on potentially
        // outdated event data.
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);

        await updateSubscriptionStatus(
          subscriptionId,
          subscription.status,
          subscription.cancel_at_period_end ?? false,
          getStripeId(subscription.customer),
          subscription.metadata?.firebaseUID
        );

        console.log(
          `Updated subscription ${subscriptionId}: ${subscription.status}`
        );

        break;
      }

      // 3. PAYMENT FAILED
      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;

        const subscriptionId = getInvoiceSubscriptionId(invoice);
        const customerId = getStripeId(invoice.customer);

        if (!subscriptionId) break;

        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);

        await updateSubscriptionStatus(
          subscriptionId,
          subscription.status,
          subscription.cancel_at_period_end ?? false,
          customerId,
          subscription.metadata?.firebaseUID
        );

        console.log(
          `Payment failed for subscription ${subscriptionId}. Current status: ${subscription.status}`
        );

        break;
      }

      // 4. SUBSCRIPTION DELETED / CANCELED
      case 'customer.subscription.deleted': {
        const subscription =
          event.data.object as Stripe.Subscription;

        const subscriptionId = subscription.id;
        const customerId = getStripeId(subscription.customer);

        const userDocs = await findUserDocuments(
          subscriptionId,
          customerId,
          subscription.metadata?.firebaseUID
        );

        if (userDocs.length === 0) {
          console.warn(
            `No Firebase user found for canceled subscription ${subscriptionId}.`
          );
          break;
        }

        const batch = adminDb.batch();

        userDocs.forEach((userDoc) => {
          batch.set(
            userDoc,
            {
              subscriptionStatus: 'canceled',
              planTier: 'Free',
              maxWorkers: 3,
              cancelAtPeriodEnd: false,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        });

        await batch.commit();

        console.log(
          `Processed cancellation for subscription ${subscriptionId}.`
        );

        break;
      }

      // 5. IGNORE OTHER EVENT TYPES
      default: {
        console.log(
          `Unhandled Stripe event type: ${event.type}`
        );
      }
    }

    return NextResponse.json(
      { received: true },
      { status: 200 }
    );

  } catch (err: any) {
    console.error(
      `Webhook processing error for ${event.type}:`,
      err
    );

    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
