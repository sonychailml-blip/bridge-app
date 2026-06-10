import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyDHlRdXq-D-BMI2QoBXHfeAQKymF0PucXs",
  authDomain: "bridge-898a6.firebaseapp.com",
  projectId: "bridge-898a6",
  storageBucket: "bridge-898a6.firebasestorage.app",
  messagingSenderId: "867000074738",
  appId: "1:867000074738:web:03333994b0fdfa61e02b6b",
  measurementId: "G-MN26JWQ6YR"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const functions = getFunctions(app, "europe-west1");
