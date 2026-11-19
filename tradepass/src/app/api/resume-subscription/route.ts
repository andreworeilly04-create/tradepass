import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebaseAdmin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-10-28.endive' as any,
});

export async function POST(req: Request) {
  try {
    const { subscriptionId } = await req.json();

    if (!subscriptionId) {
      return NextResponse.json(
        { error: 'Subscription ID is required.' },
        { status: 400 }
      );
    }

    // Tell Stripe to remove the scheduled cancellation
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });

    // Use Firebase Admin SDK to find and update user records securely
    const usersRef = adminDb.collection('users');
    const snapshot = await usersRef.where('subscriptionId', '==', subscriptionId).get();

    if (!snapshot.empty) {
      const batch = adminDb.batch();
      snapshot.docs.forEach((userDoc) => {
        batch.update(userDoc.ref, {
          cancelAtPeriodEnd: subscription.cancel_at_period_end, // Will be false
          subscriptionStatus: 'active',
          updatedAt: new Date(),
        });
      });
      await batch.commit();
    }

    return NextResponse.json({
      success: true,
      subscriptionStatus: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });
  } catch (err: any) {
    console.error('Resume Subscription Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to resume subscription' },
      { status: 500 }
    );
  }
}