import { createContext, useContext } from 'react'
import type { User } from 'firebase/auth'

export type UserProfile = {
  uid: string
  fullName: string
  email: string
  phone: string
  nic: string
  status: 'pending' | 'approved' | 'denied' | 'disabled'
  createdAt?: number
}

export type AuthContextValue = {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  error: string
  isAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  register: (details: Omit<UserProfile, 'uid' | 'status'>, password: string) => Promise<void>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  clearError: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}