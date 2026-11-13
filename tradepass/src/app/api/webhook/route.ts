import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-10-28.endive',
});

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    const bodyText = await req.text();
    
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
        const invoice = event.data.object as Stripe.Invoice;
        
        // Safely extract subscription ID whether it's a string, object, or null
        const subField = (invoice as any)?.subscription;
        const subscriptionId = typeof subField === 'string' 
          ? subField 
          : subField && typeof subField === 'object' && 'id' in subField 
            ? (subField as any).id 
            : null;

        if (!subscriptionId) {
          break; // Normal for non-subscription invoices
        }

        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('subscriptionId', '==', subscriptionId));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          for (const userDoc of querySnapshot.docs) {
            await updateDoc(doc(db, 'users', userDoc.id), {
              subscriptionStatus: 'active',
              updatedAt: new Date(),
            });
          }
          console.log(`Successfully activated subscription for sub ID: ${subscriptionId}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription?.id;
        const status = subscription?.status;

        if (!subscriptionId || !status) break;

        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('subscriptionId', '==', subscriptionId));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          for (const userDoc of querySnapshot.docs) {
            await updateDoc(doc(db, 'users', userDoc.id), {
              subscriptionStatus: status,
              cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
              updatedAt: new Date(),
            });
          }
          console.log(`Updated subscription ${subscriptionId} status to: ${status}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription?.id;

        if (!subscriptionId) break;

        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('subscriptionId', '==', subscriptionId));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          for (const userDoc of querySnapshot.docs) {
            await updateDoc(doc(db, 'users', userDoc.id), {
              subscriptionStatus: 'canceled',
              cancelAtPeriodEnd: false,
              updatedAt: new Date(),
            });
          }
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