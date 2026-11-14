import { NextResponse } from 'next/server';
import Stripe from 'stripe';

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

    // SCENARIO A: User is changing tiers -> Force payment input collection
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const subscriptionItemId = subscription.items.data[0].id;

      const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
        items: [
          {
            id: subscriptionItemId,
            price: priceId,
          },
        ],
        proration_behavior: 'always_invoice',
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
      });

      let clientSecret: string | null = null;

      const latestInvoice = updatedSubscription.latest_invoice as any;
      if (latestInvoice && typeof latestInvoice === 'object' && latestInvoice.payment_intent) {
        const pi = latestInvoice.payment_intent as any;
        clientSecret = pi.client_secret;
      }

      if (!clientSecret && updatedSubscription.pending_setup_intent) {
        const si = updatedSubscription.pending_setup_intent as any;
        clientSecret = si.client_secret;
      }

      return NextResponse.json({
        success: true,
        subscriptionId: updatedSubscription.id,
        clientSecret,
      });
    }

    // SCENARIO B: Brand-new user signing up for the first time
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customer = customers.data[0];

    if (!customer) {
      customer = await stripe.customers.create({
        email,
        name: companyName,
        metadata: { firebaseUID: uid },
      });
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