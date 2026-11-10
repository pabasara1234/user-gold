export const appBaseUrl = import.meta.env.BASE_URL

export function appPath(path = '') {
  return `${appBaseUrl}${path.replace(/^\//, '')}`
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export function apiUrl(path: string) {
  return `${apiBaseUrl}${path}`
}