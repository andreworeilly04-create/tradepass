import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-10-28.endive',
});

// Disable Next.js body parser so we can read the raw request stream for Stripe signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(req: Request) {
  const bodyText = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      bodyText,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice as any;
        const subscriptionId = invoice.subscription as string;

        if (subscriptionId) {
          const usersRef = collection(db, 'users');
          const q = query(usersRef, where('subscriptionId', '==', subscriptionId));
          const querySnapshot = await getDocs(q);

          if (!querySnapshot.empty) {
            querySnapshot.forEach(async (userDoc) => {
              await updateDoc(doc(db, 'users', userDoc.id), {
                subscriptionStatus: 'active',
                updatedAt: new Date(),
              });
            });
            console.log(`Successfully activated subscription for sub ID: ${subscriptionId}`);
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;
        const status = subscription.status;

        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('subscriptionId', '==', subscriptionId));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          querySnapshot.forEach(async (userDoc) => {
            await updateDoc(doc(db, 'users', userDoc.id), {
              subscriptionStatus: status,
              updatedAt: new Date(),
            });
          });
          console.log(`Updated subscription ${subscriptionId} status to: ${status}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;

        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('subscriptionId', '==', subscriptionId));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          querySnapshot.forEach(async (userDoc) => {
            await updateDoc(doc(db, 'users', userDoc.id), {
              subscriptionStatus: 'canceled',
              updatedAt: new Date(),
            });
          });
          console.log(`Marked subscription ${subscriptionId} as canceled.`);
        }
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
  } catch (dbErr: any) {
    console.error('Error updating Firestore in webhook:', dbErr);
    return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}