import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

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

    // Find or create customer first so we always have a reliable customer ID
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customer = customers.data[0];

    let activeSubId = subscriptionId;

    if (!customer) {
      customer = await stripe.customers.create({
        email,
        name: companyName,
        metadata: { firebaseUID: uid },
      });
    } else if (!activeSubId) {
      // Fallback: If logged in / existing customer but subscriptionId wasn't passed, find their latest subscription
      const existingSubs = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 1,
      });
      if (existingSubs.data.length > 0) {
        activeSubId = existingSubs.data[0].id;
      }
    }

    const maxWorkersLimit = priceId === process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID ? 10 : priceId === process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID ? 25 : 999;
    
    // Determine tier name dynamically
    let tierNameObj = 'Crew Pro';
    if (priceId === process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID) tierNameObj = 'Standard Crew';
    else if (priceId === process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID) tierNameObj = 'Multi-Crew Enterprise';

    // SCENARIO A: User is changing tiers (we found an existing subscription)
    if (activeSubId) {
      let subscription = await stripe.subscriptions.retrieve(activeSubId);

      if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
        // Drop down to creation logic below if the subscription is totally dead
      } else {
        if (subscription.status === 'incomplete') {
          await stripe.subscriptions.cancel(activeSubId);
          console.log(`Canceled abandoned incomplete subscription: ${activeSubId}`);

          const newSubscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: priceId }],
            payment_behavior: 'default_incomplete',
            payment_settings: { save_default_payment_method: 'on_subscription' },
            expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
          });

          let clientSecret: string | null = null;
          const latestInv = newSubscription.latest_invoice as any;
          if (latestInv && typeof latestInv === 'object' && latestInv.payment_intent) {
            clientSecret = (latestInv.payment_intent as any).client_secret;
          }
          if (!clientSecret && newSubscription.pending_setup_intent) {
            clientSecret = (newSubscription.pending_setup_intent as any).client_secret;
          }

          await updateDoc(doc(db, 'users', uid), {
            planTier: tierNameObj,
            maxWorkers: maxWorkersLimit,
            subscriptionId: newSubscription.id,
            cancelAtPeriodEnd: false,
            subscriptionStatus: 'active',
          });

          return NextResponse.json({
            success: true,
            subscriptionId: newSubscription.id,
            clientSecret,
          });
        }

        // Standard update for active subscriptions (upgrades/downgrades)
        const subscriptionItemId = subscription.items.data[0].id;

        const updatedSubscription = await stripe.subscriptions.update(activeSubId, {
          items: [{ id: subscriptionItemId, price: priceId }],
          proration_behavior: 'create_prorations',
          cancel_at_period_end: false, // CRUCIAL: Resets cancellation so changed tier is active & auto-renewing
          expand: ['latest_invoice.payment_intent'],
        });

        let clientSecret: string | null = null;
        const latestInvoice = updatedSubscription.latest_invoice as any;
        
        if (latestInvoice && typeof latestInvoice === 'object' && latestInvoice.payment_intent) {
          const pi = latestInvoice.payment_intent as any;
          if (pi.status === 'requires_action' || pi.status === 'requires_payment_method') {
            clientSecret = pi.client_secret;
          }
        }

        await updateDoc(doc(db, 'users', uid), {
          planTier: tierNameObj,
          maxWorkers: maxWorkersLimit,
          subscriptionId: updatedSubscription.id,
          cancelAtPeriodEnd: false,
          subscriptionStatus: 'active',
        });

        return NextResponse.json({
          success: true,
          subscriptionId: updatedSubscription.id,
          clientSecret, // Null on downgrades -> instant success without card prompt!
        });
      }
    }

    // SCENARIO B: Brand-new user signing up for the first time
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
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
    });

    let clientSecret: string | null = null;
    const latestInvoice = subscription.latest_invoice as any;
    if (latestInvoice && typeof latestInvoice === 'object' && latestInvoice.payment_intent) {
      const pi = latestInvoice.payment_intent as any;
      clientSecret = pi.client_secret;
    }

    if (!clientSecret && subscription.pending_setup_intent) {
      const si = subscription.pending_setup_intent as any;
      clientSecret = si.client_secret;
    }

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