import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16' as any,
});

export async function POST(req: Request) {
  try {
    const { amount = 6900, currency = 'usd', email, uid } = await req.json();

    // Create a PaymentIntent for immediate card processing
    const paymentIntent = await stripe.paymentIntents.create({
      amount, // Amount in cents ($69.00 for Crew Pro)
      currency,
      receipt_email: email,
      metadata: {
        firebaseUID: uid,
      },
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err: any) {
    console.error('PaymentIntent Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}