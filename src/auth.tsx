import { useEffect, useState, type ReactNode } from 'react'
import {
  EmailAuthProvider,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
  type User,
} from 'firebase/auth'
import { onValue, ref, serverTimestamp, set, type Unsubscribe } from 'firebase/database'
import { adminAuth, adminProfilesDb, adminUids, auth, firebaseReady, profilesDb } from './firebase'
import { AuthContext, type AuthContextValue, type UserProfile } from './auth-context'

export function AuthProvider({ children, session = 'user' }: { children: ReactNode; session?: 'user' | 'admin' }) {
  const activeAuth = session === 'admin' ? adminAuth : auth
  const activeProfilesDb = session === 'admin' ? adminProfilesDb : profilesDb
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(firebaseReady)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeAuth || !activeProfilesDb) {
      return
    }
    let profileUnsubscribe: Unsubscribe | undefined
    let unsubscribe: Unsubscribe | undefined
    let disposed = false
    const watchAuth = () => {
      unsubscribe = onAuthStateChanged(activeAuth, (nextUser) => {
      profileUnsubscribe?.()
      setUser(nextUser)
      setProfile(null)
      if (!nextUser) {
        setLoading(false)
        return
      }
      setLoading(true)
      profileUnsubscribe = onValue(ref(activeProfilesDb, `users/${nextUser.uid}`), (snapshot) => {
        setProfile(snapshot.exists() ? snapshot.val() as UserProfile : null)
        setLoading(false)
      }, () => {
        setError('Could not load your account details. Check the Firebase database rules.')
        setLoading(false)
      })
      })
    }
    if (session === 'admin') {
      void setPersistence(activeAuth, browserSessionPersistence)
        .then(() => { if (!disposed) watchAuth() })
        .catch(() => {
          setError('Could not start the administrator sign-in session.')
          setLoading(false)
        })
    } else {
      watchAuth()
    }
    return () => {
      disposed = true
      unsubscribe?.()
      profileUnsubscribe?.()
    }
  }, [activeAuth, activeProfilesDb, session])

  const value: AuthContextValue = {
    user,
    profile,
    loading,
    error,
    isAdmin: Boolean(user && adminUids.has(user.uid)),
    login: async (email, password) => {
      if (!activeAuth) throw new Error('Firebase is not configured.')
      await signInWithEmailAndPassword(activeAuth, email.trim(), password)
    },
    resetPassword: async (email) => {
      if (!activeAuth) throw new Error('Firebase is not configured.')
      await sendPasswordResetEmail(activeAuth, email.trim())
    },
    register: async (details, password) => {
      if (!activeAuth || !activeProfilesDb) throw new Error('Firebase is not configured.')
      const credential = await createUserWithEmailAndPassword(activeAuth, details.email.trim(), password)
      await updateProfile(credential.user, { displayName: details.fullName.trim() })
      await set(ref(activeProfilesDb, `users/${credential.user.uid}`), {
        ...details,
        uid: credential.user.uid,
        fullName: details.fullName.trim(),
        email: details.email.trim(),
        nic: details.nic.trim().toUpperCase(),
        status: 'pending',
        createdAt: serverTimestamp(),
      })
      await signOut(activeAuth)
    },
    logout: async () => {
      if (activeAuth) await signOut(activeAuth)
    },
    changePassword: async (currentPassword, newPassword) => {
      if (!user?.email) throw new Error('Sign in with an email account before changing your password.')
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword))
      await updatePassword(user, newPassword)
    },
    clearError: () => setError(''),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
