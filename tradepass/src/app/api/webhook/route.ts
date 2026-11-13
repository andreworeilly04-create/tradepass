import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-10-28.endive',
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

    let subscription;

    if (subscriptionId) {
      // Retrieve existing subscription to find its item ID
      const existingSub = await stripe.subscriptions.retrieve(subscriptionId);
      const subscriptionItemId = existingSub?.items?.data?.[0]?.id;

      // Update the subscription
      subscription = await stripe.subscriptions.update(subscriptionId, {
        items: [{ id: subscriptionItemId, price: priceId }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
      });
    } else {
      // Find or create customer
      const customers = await stripe.customers.list({ email, limit: 1 });
      let customer = customers?.data?.[0];

      if (!customer) {
        customer = await stripe.customers.create({
          email,
          name: companyName,
          metadata: { firebaseUID: uid },
        });
      }

      // Create a new subscription
      subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
      });
    }

    // Defensive extraction preventing the undefined crash
    const latestInvoice = subscription?.latest_invoice;
    const invoiceObj = typeof latestInvoice === 'object' ? latestInvoice as Stripe.Invoice : null;
    const paymentIntent = invoiceObj?.payment_intent;
    const paymentIntentObj = typeof paymentIntent === 'object' ? paymentIntent as Stripe.PaymentIntent : null;

    const clientSecret = paymentIntentObj?.client_secret;

    if (!clientSecret) {
      return NextResponse.json(
        { error: 'Failed to generate payment intent client secret from Stripe.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      subscriptionId: subscription.id,
      clientSecret: clientSecret,
    });

  } catch (err: any) {
    console.error('Subscription API Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to process subscription' },
      { status: 500 }
    );
  }
}