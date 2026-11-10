import { useEffect, useState, type ReactNode } from 'react'
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
  type User,
} from 'firebase/auth'
import { onValue, ref, serverTimestamp, set, type Unsubscribe } from 'firebase/database'
import { adminUids, auth, firebaseReady, profilesDb } from './firebase'
import { AuthContext, type AuthContextValue, type UserProfile } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(firebaseReady)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!auth || !profilesDb) {
      return
    }
    let profileUnsubscribe: Unsubscribe | undefined
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      profileUnsubscribe?.()
      setUser(nextUser)
      setProfile(null)
      if (!nextUser) {
        setLoading(false)
        return
      }
      setLoading(true)
      profileUnsubscribe = onValue(ref(profilesDb, `users/${nextUser.uid}`), (snapshot) => {
        setProfile(snapshot.exists() ? snapshot.val() as UserProfile : null)
        setLoading(false)
      }, () => {
        setError('Could not load your account details. Check the Firebase database rules.')
        setLoading(false)
      })
    })
    return () => {
      unsubscribe()
      profileUnsubscribe?.()
    }
  }, [])

  const value: AuthContextValue = {
    user,
    profile,
    loading,
    error,
    isAdmin: Boolean(user && adminUids.has(user.uid)),
    login: async (email, password) => {
      if (!auth) throw new Error('Firebase is not configured.')
      await signInWithEmailAndPassword(auth, email.trim(), password)
    },
    resetPassword: async (email) => {
      if (!auth) throw new Error('Firebase is not configured.')
      await sendPasswordResetEmail(auth, email.trim())
    },
    register: async (details, password) => {
      if (!auth || !profilesDb) throw new Error('Firebase is not configured.')
      const credential = await createUserWithEmailAndPassword(auth, details.email.trim(), password)
      await updateProfile(credential.user, { displayName: details.fullName.trim() })
      await set(ref(profilesDb, `users/${credential.user.uid}`), {
        ...details,
        uid: credential.user.uid,
        fullName: details.fullName.trim(),
        email: details.email.trim(),
        nic: details.nic.trim().toUpperCase(),
        status: 'pending',
        createdAt: serverTimestamp(),
      })
    },
    logout: async () => {
      if (auth) await signOut(auth)
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
