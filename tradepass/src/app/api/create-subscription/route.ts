import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebaseAdmin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-10-28.endive' as any,
});

// ==========================================
// TRADEPASS TIER CONFIGURATION
// ==========================================

function getTierDetails(priceId: string) {
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID) {
    return {
      rank: 1,
      planTier: 'Standard Crew',
      maxWorkers: 10,
    };
  }

  if (priceId === process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID) {
    return {
      rank: 2,
      planTier: 'Crew Pro',
      maxWorkers: 25,
    };
  }

  if (priceId === process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID) {
    return {
      rank: 3,
      planTier: 'Multi-Crew Enterprise',
      maxWorkers: 999,
    };
  }

  return null;
}

// ==========================================
// GET PAYMENT OR SETUP INTENT CLIENT SECRET
// ==========================================

async function getSubscriptionClientSecret(
  subscription: Stripe.Subscription
) {
  let setupIntent: any = subscription.pending_setup_intent;
  const latestInvoice: any = subscription.latest_invoice;

  if (latestInvoice) {
    let invoice: any = latestInvoice;

    if (typeof latestInvoice === 'string') {
      invoice = await stripe.invoices.retrieve(latestInvoice, {
        expand: ['confirmation_secret', 'payment_intent'],
      });
    }

    // Modern Stripe API versions (2026-10-28.endive) expose client_secret via confirmation_secret
    if (invoice?.confirmation_secret?.client_secret) {
      return {
        clientSecret: invoice.confirmation_secret.client_secret,
        intentType: 'payment',
      };
    }

    let paymentIntent: any = invoice?.payment_intent || null;

    if (typeof paymentIntent === 'string') {
      paymentIntent = await stripe.paymentIntents.retrieve(
        paymentIntent
      );
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

// ==========================================
// SAVE A CONFIRMED SUBSCRIPTION TIER
// ==========================================

async function saveSubscriptionTier(
  uid: string,
  subscription: Stripe.Subscription,
  tier: {
    planTier: string;
    maxWorkers: number;
  }
) {
  await adminDb.collection('users').doc(uid).set(
    {
      planTier: tier.planTier,
      maxWorkers: tier.maxWorkers,
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      cancelAtPeriodEnd:
        subscription.cancel_at_period_end ?? false,
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

// ==========================================
// VOID ANY OPEN INVOICE BEFORE CANCELING
// ==========================================

async function cancelAndVoidSubscription(
  subscription: Stripe.Subscription
) {
  const latestInvoice = subscription.latest_invoice;
  const invoiceId =
    typeof latestInvoice === 'string'
      ? latestInvoice
      : latestInvoice?.id;

  if (invoiceId) {
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      if (invoice.status === 'open') {
        await stripe.invoices.voidInvoice(invoiceId);
      }
    } catch (err) {
      console.warn('Could not void open invoice:', err);
    }
  }

  await stripe.subscriptions.cancel(subscription.id);
}

// ==========================================
// MAIN SUBSCRIPTION API
// ==========================================

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
        {
          error: 'Missing required fields (email, priceId, uid).',
        },
        { status: 400 }
      );
    }

    // ==========================================
    // VALIDATE SELECTED TIER
    // ==========================================

    const newTier = getTierDetails(priceId);

    if (!newTier) {
      return NextResponse.json(
        { error: 'Invalid subscription price selected.' },
        { status: 400 }
      );
    }

    // ==========================================
    // FIND OR CREATE STRIPE CUSTOMER (STRICT UID MATCH)
    // ==========================================

    const customers = await stripe.customers.list({
      email,
      limit: 10,
    });

    let customer = customers.data.find(
      (item) => item.metadata?.firebaseUID === uid
    );

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
          ...customer.metadata,
          firebaseUID: uid,
          companyName: companyName || '',
        },
      });
    }

    // ==========================================
    // FIND EXISTING SUBSCRIPTION
    // ==========================================

    let activeSubId: string | null = subscriptionId || null;

    if (activeSubId) {
      try {
        await stripe.subscriptions.retrieve(activeSubId);
      } catch (err: any) {
        console.warn(
          `Passed subscriptionId "${activeSubId}" not found, falling back to customer lookup.`
        );
        activeSubId = null;
      }
    }

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
          sub.status === 'unpaid' ||
          sub.status === 'incomplete'
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
            'latest_invoice.confirmation_secret',
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
          {
            error:
              'Subscription does not belong to this customer.',
          },
          { status: 403 }
        );
      }

      // ==========================================
      // HANDLE PREVIOUS INCOMPLETE SUBSCRIPTION
      // ==========================================

      if (subscription.status === 'incomplete') {
        await cancelAndVoidSubscription(subscription);
        activeSubId = null;
      }

      // ==========================================
      // HANDLE PAST-DUE OR UNPAID SUBSCRIPTION
      // ==========================================

      else if (
        subscription.status === 'past_due' ||
        subscription.status === 'unpaid'
      ) {
        const currentItem = subscription.items.data[0];

        if (currentItem?.price.id === priceId) {
          const intent = await getSubscriptionClientSecret(
            subscription
          );

          if (intent.clientSecret) {
            return NextResponse.json({
              success: true,
              subscriptionId: subscription.id,
              clientSecret: intent.clientSecret,
              intentType: intent.intentType,
            });
          }
        }

        await cancelAndVoidSubscription(subscription);
        activeSubId = null;
      }

      // ==========================================
      // HANDLE ACTIVE OR TRIALING SUBSCRIPTION
      // ==========================================

      else if (
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

        const currentTier = getTierDetails(
          currentItem.price.id
        );

        if (!currentTier) {
          return NextResponse.json(
            {
              error:
                'The current subscription tier could not be identified.',
            },
            { status: 400 }
          );
        }

        // ==========================================
        // SAME TIER: NO PAYMENT REQUIRED
        // ==========================================

        if (currentItem.price.id === priceId) {
          return NextResponse.json({
            success: true,
            isNoChange: true,
            subscriptionId: subscription.id,
          });
        }

        // ==========================================
        // DOWNGRADE
        // ==========================================

        if (newTier.rank < currentTier.rank) {
          const updatedSubscription =
            await stripe.subscriptions.update(
              subscription.id,
              {
                items: [
                  {
                    id: currentItem.id,
                    price: priceId,
                  },
                ],
                proration_behavior: 'create_prorations',
                cancel_at_period_end: false,
              }
            );

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

        // ==========================================
        // UPGRADE (SAVE PAYMENT METHOD, NO ALWAYS_INVOICE)
        // ==========================================

        const updatedSubscription =
          await stripe.subscriptions.update(
            subscription.id,
            {
              items: [
                {
                  id: currentItem.id,
                  price: priceId,
                },
              ],
              cancel_at_period_end: false,
              payment_behavior: 'default_incomplete',
              payment_settings: {
                save_default_payment_method: 'on_subscription',
              },
              expand: [
                'latest_invoice.confirmation_secret',
                'latest_invoice.payment_intent',
                'pending_setup_intent',
              ],
            }
          );

        const intent = await getSubscriptionClientSecret(
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
            success: false,
            error:
              'Stripe did not generate a payment confirmation. Please check the subscription invoice and try again.',
            subscriptionId: updatedSubscription.id,
          },
          { status: 400 }
        );
      }

      // ==========================================
      // HANDLE CANCELED OR EXPIRED SUBSCRIPTION
      // ==========================================

      else {
        activeSubId = null;
      }
    }

    // ==========================================
    // SCENARIO B: BRAND-NEW OR RENEWED SUBSCRIPTION
    // ==========================================

    const existingIncomplete =
      await stripe.subscriptions.list({
        customer: customer.id,
        status: 'incomplete',
        limit: 20,
      });

    for (const oldSubscription of existingIncomplete.data) {
      await cancelAndVoidSubscription(oldSubscription);
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
        'latest_invoice.confirmation_secret',
        'latest_invoice.payment_intent',
        'pending_setup_intent',
      ],
    });

    const intent = await getSubscriptionClientSecret(
      subscription
    );

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
      await saveSubscriptionTier(
        uid,
        subscription,
        newTier
      );

      return NextResponse.json({
        success: true,
        isNoPaymentRequired: true,
        subscriptionId: subscription.id,
      });
    }

    return NextResponse.json(
      {
        success: false,
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
        error:
          err.message || 'Failed to process subscription.',
      },
      { status: 500 }
    );
  }
}