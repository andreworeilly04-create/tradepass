import { initializeApp, getApps, cert } from 'firebase-admin/app'; // Note: or 'firebase-admin/app' depending on version
import { getFirestore } from 'firebase-admin/firestore';

// If you are using standard Next.js / Firebase service account environment variables:
const serviceAccount = {
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount as any),
  });
}

export const adminDb = getFirestore();