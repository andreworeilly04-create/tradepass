import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-10-28.endive' as any,
});

export async function POST(req: Request) {
  try {
    const { uid, subscriptionId: passedSubId } = await req.json();

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
        {
          success: false,
          needsNewSubscription: true,
          error: 'No subscription found to resume.',
        },
        { status: 404 }
      );
    }

    let subscription: Stripe.Subscription;

    try {
      subscription = await stripe.subscriptions.retrieve(
        subscriptionId
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
          success: false,
          needsNewSubscription: true,
          status: 'canceled',
          cancelAtPeriodEnd: false,
          error:
            'Subscription no longer exists. Please start a new subscription.',
        });
      }

      throw err;
    }

    // A canceled subscription cannot be reactivated—start a fresh checkout instead
    if (subscription.status === 'canceled') {
      await userRef.set(
        {
          subscriptionId: subscription.id,
          subscriptionStatus: 'canceled',
          cancelAtPeriodEnd: false,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return NextResponse.json({
        success: false,
        needsNewSubscription: true,
        subscriptionId: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: false,
        error:
          'Subscription has already ended and cannot be resumed. Please start a new plan.',
      });
    }

    // Resume an active or trialing subscription scheduled for cancellation
    const updatedSubscription = await stripe.subscriptions.update(
      subscription.id,
      {
        cancel_at_period_end: false,
      }
    );

    await userRef.set(
      {
        subscriptionId: updatedSubscription.id,
        subscriptionStatus: updatedSubscription.status,
        cancelAtPeriodEnd:
          updatedSubscription.cancel_at_period_end ?? false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      needsNewSubscription: false,
      subscriptionId: updatedSubscription.id,
      status: updatedSubscription.status,
      cancelAtPeriodEnd:
        updatedSubscription.cancel_at_period_end ?? false,
    });
  } catch (err: any) {
    console.error('Resume Subscription API Error:', err);

    return NextResponse.json(
      {
        success: false,
        error:
          err.message || 'Failed to resume subscription.',
      },
      { status: 500 }
    );
  }
}