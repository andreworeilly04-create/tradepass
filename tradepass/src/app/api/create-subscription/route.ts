

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebaseAdmin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16' as any,
});

function getTierDetails(priceId: string) {
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID) {
    return { rank: 1, planTier: 'Standard Crew', maxWorkers: 10 };
  }

  if (priceId === process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID) {
    return { rank: 2, planTier: 'Crew Pro', maxWorkers: 25 };
  }

  if (priceId === process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID) {
    return { rank: 3, planTier: 'Multi-Crew Enterprise', maxWorkers: 999 };
  }

  return null;
}

async function getSubscriptionIntent(subscription: Stripe.Subscription) {
  let invoice: any = subscription.latest_invoice;
  let paymentIntent: any = null;

  if (typeof invoice === 'string') {
    invoice = await stripe.invoices.retrieve(invoice, {
      expand: ['payment_intent'],
    });
  }

  paymentIntent = invoice?.payment_intent;

  if (typeof paymentIntent === 'string') {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
  }

  if (paymentIntent?.client_secret) {
    return {
      clientSecret: paymentIntent.client_secret,
      intentType: 'payment',
    };
  }

  let setupIntent: any = subscription.pending_setup_intent;

  if (typeof setupIntent === 'string') {
    setupIntent = await stripe.setupIntents.retrieve(setupIntent);
  }

  if (setupIntent?.client_secret) {
    return {
      clientSecret: setupIntent.client_secret,
      intentType: 'setup',
    };
  }

  return {
    clientSecret: null,
    intentType: null,
  };
}

async function saveSubscriptionTier(
  uid: string,
  subscription: Stripe.Subscription,
  tier: { planTier: string; maxWorkers: number }
) {
  await adminDb.collection('users').doc(uid).set(
    {
      planTier: tier.planTier,
      maxWorkers: tier.maxWorkers,
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

export async function POST(req: Request) {
  try {
    const {
      email,
      companyName,
      priceId,
      uid,
      subscriptionId,
    } = await req.json();

    if (!email || !priceId || !uid) {
      return NextResponse.json(
        { error: 'Missing required fields (email, priceId, uid).' },
        { status: 400 }
      );
    }

    const newTier = getTierDetails(priceId);

    if (!newTier) {
      return NextResponse.json(
        { error: 'Invalid subscription price selected.' },
        { status: 400 }
      );
    }

    // Find or create the Stripe customer.
    const customers = await stripe.customers.list({
      email,
      limit: 10,
    });

    let customer = customers.data.find(
      (item) => item.metadata?.firebaseUID === uid
    );

    if (!customer) {
      customer = customers.data[0];
    }

    if (!customer) {
      customer = await stripe.customers.create({
        email,
        name: companyName,
        metadata: {
          firebaseUID: uid,
          companyName: companyName || '',
        },
      });
    } else {
      customer = await stripe.customers.update(customer.id, {
        email,
        name: companyName,
        metadata: {
          firebaseUID: uid,
          companyName: companyName || '',
        },
      });
    }

    let activeSubId: string | null = subscriptionId || null;

    // Find an existing subscription if the user profile has no ID.
    if (!activeSubId) {
      const existingSubs = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 20,
      });

      const existingSubscription = existingSubs.data.find(
        (sub) =>
          sub.status === 'active' ||
          sub.status === 'trialing' ||
          sub.status === 'past_due' ||
          sub.status === 'incomplete'
      );

      if (existingSubscription) {
        activeSubId = existingSubscription.id;
      }
    }

    // ==========================================
    // EXISTING SUBSCRIPTION
    // ==========================================

    if (activeSubId) {
      const subscription = await stripe.subscriptions.retrieve(
        activeSubId,
        {
          expand: [
            'latest_invoice.payment_intent',
            'pending_setup_intent',
          ],
        }
      );

      const subscriptionCustomer =
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;

      if (subscriptionCustomer !== customer.id) {
        return NextResponse.json(
          { error: 'Subscription does not belong to this customer.' },
          { status: 403 }
        );
      }

      // An incomplete subscription cannot safely be upgraded.
      // Cancel it and create a fresh subscription below.
      if (subscription.status === 'incomplete') {
        await stripe.subscriptions.cancel(subscription.id);
        activeSubId = null;
      } else if (
        subscription.status === 'active' ||
        subscription.status === 'trialing'
      ) {
        const currentItem = subscription.items.data[0];

        if (!currentItem) {
          return NextResponse.json(
            { error: 'No subscription item was found.' },
            { status: 400 }
          );
        }

        const currentTier = getTierDetails(currentItem.price.id);

        if (!currentTier) {
          return NextResponse.json(
            { error: 'The current subscription tier could not be identified.' },
            { status: 400 }
          );
        }

        // No change needed if the user selected the current tier.
        if (currentItem.price.id === priceId) {
          return NextResponse.json({
            success: true,
            isNoChange: true,
            subscriptionId: subscription.id,
          });
        }

        // DOWNGRADE: preserve the existing immediate downgrade behavior.
        if (newTier.rank < currentTier.rank) {
          const updatedSubscription =
            await stripe.subscriptions.update(subscription.id, {
              items: [
                {
                  id: currentItem.id,
                  price: priceId,
                },
              ],
              proration_behavior: 'create_prorations',
              cancel_at_period_end: false,
              metadata: {
                firebaseUID: uid,
              },
            });

          await saveSubscriptionTier(
            uid,
            updatedSubscription,
            newTier
          );

          return NextResponse.json({
            success: true,
            isDowngrade: true,
            subscriptionId: updatedSubscription.id,
          });
        }

        // UPGRADE: invoice the prorated amount immediately.
        // Keep the new price pending until payment succeeds.
        const updatedSubscription =
          await stripe.subscriptions.update(subscription.id, {
            items: [
              {
                id: currentItem.id,
                price: priceId,
              },
            ],
            proration_behavior: 'always_invoice',
            payment_behavior: 'pending_if_incomplete',
            cancel_at_period_end: false,
            metadata: {
              firebaseUID: uid,
            },
            payment_settings: {
              save_default_payment_method: 'on_subscription',
            },
            expand: [
              'latest_invoice.payment_intent',
              'pending_setup_intent',
            ],
          });

        const intent = await getSubscriptionIntent(
          updatedSubscription
        );

        if (intent.clientSecret) {
          return NextResponse.json({
            success: true,
            subscriptionId: updatedSubscription.id,
            clientSecret: intent.clientSecret,
            intentType: intent.intentType,
          });
        }

        // Stripe may have completed the change without requiring
        // another card confirmation.
        const updatedItem = updatedSubscription.items.data.find(
          (item) => item.price.id === priceId
        );

        if (
          updatedItem &&
          (updatedSubscription.status === 'active' ||
            updatedSubscription.status === 'trialing')
        ) {
          await saveSubscriptionTier(
            uid,
            updatedSubscription,
            newTier
          );

          return NextResponse.json({
            success: true,
            isNoPaymentRequired: true,
            subscriptionId: updatedSubscription.id,
          });
        }

        return NextResponse.json(
          {
            error:
              'Stripe did not generate a payment confirmation. Please try again or contact support.',
            subscriptionId: updatedSubscription.id,
          },
          { status: 400 }
        );
      } else if (subscription.status === 'past_due') {
        return NextResponse.json(
          {
            error:
              'Your previous subscription payment is past due. Please resolve the outstanding payment before changing tiers.',
          },
          { status: 409 }
        );
      } else if (
        subscription.status !== 'canceled' &&
        subscription.status !== 'incomplete_expired'
      ) {
        return NextResponse.json(
          {
            error: `Your subscription currently has status "${subscription.status}". Please resolve this subscription before changing tiers.`,
          },
          { status: 409 }
        );
      } else {
        activeSubId = null;
      }
    }

    // ==========================================
    // BRAND-NEW SUBSCRIPTION
    // ==========================================

    // Cancel any older incomplete subscriptions for this customer.
    const incompleteSubscriptions =
      await stripe.subscriptions.list({
        customer: customer.id,
        status: 'incomplete',
        limit: 20,
      });

    for (const oldSubscription of incompleteSubscriptions.data) {
      await stripe.subscriptions.cancel(oldSubscription.id);
    }

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [
        {
          price: priceId,
        },
      ],
      payment_behavior: 'default_incomplete',
      collection_method: 'charge_automatically',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      metadata: {
        firebaseUID: uid,
      },
      expand: [
        'latest_invoice.payment_intent',
        'pending_setup_intent',
      ],
    });

    const intent = await getSubscriptionIntent(subscription);

    // Save tracking details without granting the paid tier early.
    await adminDb.collection('users').doc(uid).set(
      {
        companyName,
        email,
        subscriptionId: subscription.id,
        cancelAtPeriodEnd: false,
        subscriptionStatus: subscription.status,
        updatedAt: new Date(),
      },
      { merge: true }
    );

    if (intent.clientSecret) {
      return NextResponse.json({
        success: true,
        subscriptionId: subscription.id,
        clientSecret: intent.clientSecret,
        intentType: intent.intentType,
      });
    }

    if (
      subscription.status === 'active' ||
      subscription.status === 'trialing'
    ) {
      await saveSubscriptionTier(uid, subscription, newTier);

      return NextResponse.json({
        success: true,
        isNoPaymentRequired: true,
        subscriptionId: subscription.id,
      });
    }

    return NextResponse.json(
      {
        error:
          'Stripe did not generate a payment confirmation. Please try again or contact support.',
        subscriptionId: subscription.id,
      },
      { status: 400 }
    );

  } catch (err: any) {
    console.error('Subscription API Error:', err);

    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Failed to process subscription',
      },
      { status: 500 }
    );
  }
}
