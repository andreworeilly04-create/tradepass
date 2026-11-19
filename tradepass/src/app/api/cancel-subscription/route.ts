import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-10-28.endive' as any,
});

export async function POST(req: Request) {
  try {
    const {
      uid,
      subscriptionId: passedSubId,
      cancelAtPeriodEnd = true,
    } = await req.json();

    if (!uid) {
      return NextResponse.json(
        { error: 'Missing required field: uid.' },
        { status: 400 }
      );
    }

    const userRef = adminDb.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.data();

    const subscriptionId =
      passedSubId || userData?.subscriptionId || null;

    if (!subscriptionId) {
      return NextResponse.json(
        { error: 'No subscription found for this user.' },
        { status: 404 }
      );
    }

    let subscription: Stripe.Subscription;

    try {
      subscription = await stripe.subscriptions.update(
        subscriptionId,
        {
          cancel_at_period_end: Boolean(cancelAtPeriodEnd),
        }
      );
    } catch (err: any) {
      if (err?.code === 'resource_missing') {
        await userRef.set(
          {
            subscriptionStatus: 'canceled',
            cancelAtPeriodEnd: false,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return NextResponse.json({
          success: true,
          alreadyCanceled: true,
          cancelAtPeriodEnd: false,
        });
      }

      throw err;
    }

    await userRef.set(
      {
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        cancelAtPeriodEnd:
          subscription.cancel_at_period_end ?? false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      subscriptionId: subscription.id,
      status: subscription.status,
      cancelAtPeriodEnd:
        subscription.cancel_at_period_end ?? false,
    });
  } catch (err: any) {
    console.error('Cancel Subscription API Error:', err);

    return NextResponse.json(
      {
        success: false,
        error:
          err.message || 'Failed to update subscription cancellation.',
      },
      { status: 500 }
    );
  }
}