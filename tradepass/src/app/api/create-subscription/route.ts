import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-10-28.endive',
});

// Helper function to robustly extract client_secret from an invoice (handles string IDs or expanded objects)
async function getClientSecretFromInvoice(latestInvoice: string | Stripe.Invoice | null): Promise<string | null> {
  if (!latestInvoice) return null;

  let invoiceObj: Stripe.Invoice;

  if (typeof latestInvoice === 'string') {
    invoiceObj = await stripe.invoices.retrieve(latestInvoice, {
      expand: ['payment_intent'],
    });
  } else {
    invoiceObj = latestInvoice;
  }

  const pi = (invoiceObj as any).payment_intent;
  if (pi && typeof pi === 'object' && 'client_secret' in pi) {
    return pi.client_secret;
  }

  if (typeof pi === 'string') {
    const fetchedPi = await stripe.paymentIntents.retrieve(pi);
    return fetchedPi.client_secret;
  }

  return null;
}

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
        expand: ['latest_invoice.payment_intent'],
      });

      const clientSecret = await getClientSecretFromInvoice(updatedSubscription.latest_invoice);

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
      expand: ['latest_invoice.payment_intent'],
    });

    const clientSecret = await getClientSecretFromInvoice(subscription.latest_invoice);

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