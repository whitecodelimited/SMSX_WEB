import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCeK6183FRiMAjWJ9Sd0_Y3AhadmObdnBk",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "white-isms.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "white-isms",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "white-isms.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "569430942124",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID || "1:569430942124:web:7366ce4e0c2d9108199a09",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-WQJ9Z37ZLH",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
