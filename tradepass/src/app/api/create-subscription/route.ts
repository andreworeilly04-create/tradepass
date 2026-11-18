
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebaseAdmin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16' as any,
});

// Retrieve the correct client secret from Stripe.
async function getSubscriptionClientSecret(subscription: Stripe.Subscription) {
  let paymentIntent: any = null;
  let setupIntent: any = subscription.pending_setup_intent;

  const latestInvoice: any = subscription.latest_invoice;

  if (latestInvoice) {
    let invoice: any = latestInvoice;

    if (typeof latestInvoice === 'string') {
      invoice = await stripe.invoices.retrieve(latestInvoice, {
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
  }

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

    // Validate the selected Stripe price.
    const priceRanks: Record<string, number> = {};

    if (process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID) {
      priceRanks[process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID] = 1;
    }

    if (process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID) {
      priceRanks[process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID] = 2;
    }

    if (process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID) {
      priceRanks[process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID] = 3;
    }

    const newRank = priceRanks[priceId];

    if (!newRank) {
      return NextResponse.json(
        { error: 'Invalid subscription price selected.' },
        { status: 400 }
      );
    }

    let tierNameObj = 'Crew Pro';

    if (newRank === 1) {
      tierNameObj = 'Standard Crew';
    } else if (newRank === 3) {
      tierNameObj = 'Multi-Crew Enterprise';
    }

    const maxWorkersLimit =
      newRank === 1 ? 10 : newRank === 2 ? 25 : 999;

    // Find or create Stripe customer.
    const customers = await stripe.customers.list({
      email,
      limit: 1,
    });

    let customer = customers.data[0];

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
      await stripe.customers.update(customer.id, {
        name: companyName,
        metadata: {
          firebaseUID: uid,
          companyName: companyName || '',
        },
      });
    }

    let activeSubId = subscriptionId;

    // Find an existing subscription if no ID was provided.
    if (!activeSubId) {
      const existingSubs = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 10,
      });

      const existingSubscription = existingSubs.data.find(
        (sub) =>
          sub.status !== 'canceled' &&
          sub.status !== 'incomplete_expired'
      );

      if (existingSubscription) {
        activeSubId = existingSubscription.id;
      }
    }

    // ==========================================
    // SCENARIO A: EXISTING SUBSCRIPTION
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

      if (
        subscription.status !== 'canceled' &&
        subscription.status !== 'incomplete_expired'
      ) {
        const currentItem = subscription.items.data[0];

        if (!currentItem) {
          return NextResponse.json(
            { error: 'No subscription item was found.' },
            { status: 400 }
          );
        }

        const oldRank = priceRanks[currentItem.price.id] || 0;
        const isDowngrade = newRank < oldRank;

        // DOWNGRADE.
        if (isDowngrade) {
          const updatedSubscription = await stripe.subscriptions.update(
            activeSubId,
            {
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
            }
          );

          await adminDb.collection('users').doc(uid).set(
            {
              planTier: tierNameObj,
              maxWorkers: maxWorkersLimit,
              subscriptionId: updatedSubscription.id,
              cancelAtPeriodEnd: false,
              subscriptionStatus: updatedSubscription.status,
              updatedAt: new Date(),
            },
            { merge: true }
          );

          return NextResponse.json({
            success: true,
            isDowngrade: true,
            subscriptionId: updatedSubscription.id,
          });
        }

        // UPGRADE OR SAME TIER.
        const updatedSubscription = await stripe.subscriptions.update(
          activeSubId,
          {
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
            payment_behavior: 'default_incomplete',
            collection_method: 'charge_automatically',
            payment_settings: {
              save_default_payment_method: 'on_subscription',
            },
            expand: [
              'latest_invoice.payment_intent',
              'pending_setup_intent',
            ],
          }
        );

        const intent = await getSubscriptionClientSecret(
          updatedSubscription
        );

        if (!intent.clientSecret) {
          console.error(
            'Stripe did not return a PaymentIntent or SetupIntent.',
            updatedSubscription.id
          );

          return NextResponse.json(
            {
              success: false,
              error:
                'Stripe did not generate a payment confirmation. Please try again or contact support.',
              subscriptionId: updatedSubscription.id,
            },
            { status: 400 }
          );
        }

        // Do not activate the new tier before payment confirmation.
        return NextResponse.json({
          success: true,
          subscriptionId: updatedSubscription.id,
          clientSecret: intent.clientSecret,
          intentType: intent.intentType,
        });
      }
    }

    // ==========================================
    // SCENARIO B: BRAND-NEW SUBSCRIPTION
    // ==========================================

    // Cancel previous incomplete subscriptions.
    const existingIncomplete = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'incomplete',
      limit: 10,
    });

    for (const sub of existingIncomplete.data) {
      await stripe.subscriptions.cancel(sub.id);
    }

    // Create subscription.
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

    const intent = await getSubscriptionClientSecret(subscription);

    if (!intent.clientSecret) {
      console.error(
        'Stripe did not return a PaymentIntent or SetupIntent.',
        subscription.id
      );

      return NextResponse.json(
        {
          success: false,
          error:
            'Stripe did not generate a payment confirmation. Please try again or contact support.',
          subscriptionId: subscription.id,
        },
        { status: 400 }
      );
    }

    // Save subscription tracking information only.
    // The paid tier is not activated until payment is confirmed.
    await adminDb.collection('users').doc(uid).set(
      {
        companyName,
        email,
        subscriptionId: subscription.id,
        cancelAtPeriodEnd: false,
        subscriptionStatus: subscription.status,
        createdAt: new Date(),
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      subscriptionId: subscription.id,
      clientSecret: intent.clientSecret,
      intentType: intent.intentType,
    });

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
