import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebaseAdmin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16' as any,
});

export async function POST(req: Request) {
  try {
    const { email, companyName, priceId, uid, subscriptionId } = await req.json();

    if (!email || !priceId || !uid) {
      return NextResponse.json(
        { error: 'Missing required fields (email, priceId, uid).' },
        { status: 400 }
      );
    }

    const customers = await stripe.customers.list({ email, limit: 1 });
    let customer = customers.data[0];
    let activeSubId = subscriptionId;

    if (!customer) {
      customer = await stripe.customers.create({
        email,
        name: companyName,
        metadata: { firebaseUID: uid, companyName: companyName },
      });
    } else {
      await stripe.customers.update(customer.id, {
        name: companyName,
        metadata: { firebaseUID: uid, companyName: companyName },
      });
    }

    if (!activeSubId) {
      const existingSubs = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 1,
      });
      if (existingSubs.data.length > 0) {
        activeSubId = existingSubs.data[0].id;
      }
    }

    let tierNameObj = 'Crew Pro';
    if (priceId === process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID) tierNameObj = 'Standard Crew';
    else if (priceId === process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID) tierNameObj = 'Multi-Crew Enterprise';

    // SCENARIO A: User has an existing subscription record
    if (activeSubId) {
      const subscription = await stripe.subscriptions.retrieve(activeSubId);

      if (subscription.status !== 'canceled' && subscription.status !== 'incomplete_expired') {
        const currentPriceId = subscription.items.data[0].price.id;
        
        const priceRanks: Record<string, number> = {
          [process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID!]: 1,
          [process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID!]: 2,
          [process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID!]: 3,
        };

        const oldRank = priceRanks[currentPriceId] || 0;
        const newRank = priceRanks[priceId] || 0;
        const isDowngrade = newRank < oldRank;
        const subscriptionItemId = subscription.items.data[0].id;

        // DOWNGRADE: Update instantly, no card required
        if (isDowngrade) {
          const maxWorkersLimit = newRank === 1 ? 10 : 25;
          const updatedSubscription = await stripe.subscriptions.update(activeSubId, {
            items: [{ id: subscriptionItemId, price: priceId }],
            proration_behavior: 'create_prorations',
            cancel_at_period_end: false,
            metadata: { firebaseUID: uid },
          });

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
            isDowngrade: true, // Explicit flag so frontend knows not to look for a clientSecret
            subscriptionId: updatedSubscription.id,
          });
        }

        // UPGRADE or SAME TIER: Force card entry by clearing customer default payment method
        await stripe.customers.update(customer.id, {
          invoice_settings: { default_payment_method: null as any },
        });

        const updatedSubscription = await stripe.subscriptions.update(activeSubId, {
          items: [{ id: subscriptionItemId, price: priceId }],
          proration_behavior: 'create_prorations',
          cancel_at_period_end: false,
          metadata: { firebaseUID: uid },
          payment_behavior: 'default_incomplete',
          collection_method: 'charge_automatically',
          payment_settings: {
            save_default_payment_method: 'on_subscription',
          },
          expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
        });

        let clientSecret: string | undefined = undefined;
        const latestInvoice = updatedSubscription.latest_invoice as any;

        if (latestInvoice && typeof latestInvoice === 'object') {
          if (latestInvoice.payment_intent && typeof latestInvoice.payment_intent === 'object') {
            clientSecret = (latestInvoice.payment_intent as any).client_secret;
          }
        }
        if (!clientSecret && latestInvoice && typeof latestInvoice === 'string') {
          const invObj = await stripe.invoices.retrieve(latestInvoice, { expand: ['payment_intent'] }) as any;
          clientSecret = invObj.payment_intent?.client_secret;
        }

        return NextResponse.json({
          success: true,
          subscriptionId: updatedSubscription.id,
          clientSecret,
        });
      }
    }

    // SCENARIO B: Brand-new user signing up
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: null as any },
    });

    const existingIncomplete = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'incomplete',
      limit: 10,
    });

    for (const sub of existingIncomplete.data) {
      await stripe.subscriptions.cancel(sub.id);
    }

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      collection_method: 'charge_automatically',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      metadata: { firebaseUID: uid },
      expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
    });

    let clientSecret: string | undefined = undefined;
    const latestInvoice = subscription.latest_invoice as any;

    if (latestInvoice && typeof latestInvoice === 'object') {
      if (latestInvoice.payment_intent && typeof latestInvoice.payment_intent === 'object') {
        clientSecret = (latestInvoice.payment_intent as any).client_secret;
      }
    }
    if (!clientSecret && latestInvoice && typeof latestInvoice === 'string') {
      const invObj = await stripe.invoices.retrieve(latestInvoice, { expand: ['payment_intent'] }) as any;
      clientSecret = invObj.payment_intent?.client_secret;
    }

    const maxWorkersLimit =
      priceId === process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID
        ? 10
        : priceId === process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID
        ? 25
        : 999;

    await adminDb.collection('users').doc(uid).set(
      {
        companyName,
        email,
        planTier: tierNameObj,
        maxWorkers: maxWorkersLimit,
        subscriptionId: subscription.id,
        cancelAtPeriodEnd: false,
        subscriptionStatus: 'incomplete',
        createdAt: new Date(),
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      subscriptionId: subscription.id,
      clientSecret,
    });
  } catch (err: any) {
    console.error('Subscription API Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to process subscription' },
      { status: 500 }
    );
  }
}