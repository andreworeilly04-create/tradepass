import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16' as any,
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

    // Tell Stripe to cancel subscription at the end of the current billing period
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    // Optionally sync the cancellation status immediately in Firestore
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('subscriptionId', '==', subscriptionId));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      querySnapshot.forEach(async (userDoc) => {
        await updateDoc(doc(db, 'users', userDoc.id), {
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          updatedAt: new Date(),
        });
      });
    }

    return NextResponse.json({
      success: true,
      subscriptionStatus: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });
  } catch (err: any) {
    console.error('Cancel Subscription Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}