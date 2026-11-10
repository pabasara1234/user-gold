import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getDatabase, type Database } from 'firebase/database'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const profilesUrl = import.meta.env.VITE_FIREBASE_PROFILES_DATABASE_URL
export const firebaseReady = Object.values(config).every(Boolean) && Boolean(profilesUrl)

const app = firebaseReady
  ? getApps().length ? getApp() : initializeApp(config)
  : null

export const auth: Auth | null = app ? getAuth(app) : null
export const profilesDb: Database | null = app && profilesUrl ? getDatabase(app, profilesUrl) : null
export const adminUids = new Set((import.meta.env.VITE_FIREBASE_ADMIN_UIDS ?? '').split(',').map((uid) => uid.trim()).filter(Boolean))

export function signalSymbolKey(symbol: string) {
  return symbol.replaceAll('.', '_dot_')
}