const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const APP_URL = 'http://127.0.0.1:8000/marketlab.html'
const API_URL = new URL('/openapi.json', APP_URL).toString()
const STARTUP_TIMEOUT_MS = 60_000
let backendProcess = null
let backendLog = null
let mainWindow = null
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(startApplication).catch(showStartupError)
}

async function startApplication() {
  await startBackend()
  createMainWindow()
}

async function startBackend() {
  if (await isMyViewServerReady()) return

  const backendExecutable = path.join(
    process.resourcesPath,
    'backend',
    'MyViewApi.exe',
  )
  if (!fs.existsSync(backendExecutable)) {
    throw new Error('The bundled MyView API could not be found. Reinstall MyView and try again.')
  }

  const logPath = path.join(app.getPath('userData'), 'myview-api.log')
  backendLog = fs.createWriteStream(logPath, { flags: 'a' })
  backendProcess = spawn(backendExecutable, [], {
    cwd: path.dirname(backendExecutable),
    env: { ...process.env, MYVIEW_API_HOST: '127.0.0.1', MYVIEW_API_PORT: '8000' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  backendProcess.stdout.pipe(backendLog)
  backendProcess.stderr.pipe(backendLog)
  backendProcess.on('error', (error) => {
    if (!quitting) console.error('Could not start the MyView API.', error)
  })

  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (backendProcess.exitCode !== null) {
      if (await isPortOccupied()) {
        throw new Error('Port 8000 is already in use by another app. Close that app and restart MyView.')
      }
      throw new Error(`The MyView API closed during startup. See ${logPath} for details.`)
    }
    if (await isMyViewServerReady()) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(`The MyView API did not start in time. See ${logPath} for details.`)
}

async function isMyViewServerReady() {
  try {
    const response = await fetch(API_URL, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return false
    const api = await response.json()
    return api.title === 'MyView MT5 Market Data'
  } catch {
    return false
  }
}

async function isPortOccupied() {
  try {
    await fetch(new URL('/', APP_URL), { signal: AbortSignal.timeout(1500) })
    return true
  } catch {
    return false
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f7f8f7',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== new URL(APP_URL).origin) event.preventDefault()
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  void mainWindow.loadURL(APP_URL)
}

async function showStartupError(error) {
  const message = error instanceof Error ? error.message : String(error)
  await dialog.showMessageBox({
    type: 'error',
    title: 'MyView could not start',
    message,
    detail: 'Make sure MetaTrader 5 is installed. If the problem persists, reinstall MyView.',
    buttons: ['Close'],
  })
  app.quit()
}

app.on('before-quit', () => {
  quitting = true
  if (backendProcess && backendProcess.exitCode === null) backendProcess.kill()
  if (backendLog) backendLog.end()
})
