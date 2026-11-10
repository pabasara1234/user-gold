# MyView Market Lab

A local, read-only MT5 multi-timeframe liquidity strategy and backtest workspace. The browser does not send orders.

## Signal and admin websites

The production build contains two separate website entries: the approved-member signal desk at `/` and the administrator website at `/admin.html`. The existing desktop Market Lab remains available at `/marketlab.html` and is still the Electron app's entry point. Authentication, user profiles, and approval records belong to `website-sign-in-dbc96`; published signals belong to the separate `nextgen-gold` Realtime Database. Passwords are stored only by Firebase Authentication, never in either database.

1. Use Firebase project `website-sign-in-dbc96` for Email/Password Authentication and the profiles Realtime Database. Use project `nextgen-gold` for the signals Realtime Database.
2. Copy `.env.example` to `.env`, add the web API key and App ID from `website-sign-in-dbc96`, and set the actual profiles database URL. Create the administrator account in that project's Authentication and put its UID in `VITE_FIREBASE_ADMIN_UIDS`.
3. Paste `firebase.rules.profiles.json` into the `website-sign-in-dbc96` rules and `firebase.rules.signals.json` into the `nextgen-gold` rules. The signals database denies browser access; the Python API accesses it with its service account.
4. Set the Python API variables shown in `api/.env.backend.example`. Use one service account with access to `website-sign-in-dbc96` for token verification/profile reads, and a `nextgen-gold` service account for signal database access. Keep both JSON keys outside the repository. For local PowerShell development, set these values before starting Uvicorn:

  ```powershell
  $env:FIREBASE_PROJECT_ID = 'website-sign-in-dbc96'
  $env:FIREBASE_PROFILES_DATABASE_URL = 'https://website-sign-in-dbc96-default-rtdb.firebaseio.com'
  $env:FIREBASE_ADMIN_UIDS = 'hiUt8y2MAPTQeFl5aT5LsuYKkt42'
  $env:MYVIEW_REQUIRE_AUTH = 'true'
  $env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\secure\website-sign-in-service-account.json'
  $env:SIGNALS_FIREBASE_PROJECT_ID = 'nextgen-gold'
  $env:SIGNALS_FIREBASE_DATABASE_URL = 'https://nextgen-gold-default-rtdb.firebaseio.com'
  $env:SIGNALS_GOOGLE_APPLICATION_CREDENTIALS = 'C:\secure\nextgen-gold-service-account.json'
  Set-Location api
  ..\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
  ```
5. Start the MT5 API and Vite (`npm run dev`). Open `http://localhost:5173/` for the member site and `http://localhost:5173/admin.html` for access management. Sign in as the configured admin, approve member requests, and keep the admin signal relay running to publish engine signals to the signals database.

The API verifies sign-in tokens and approval status in `website-sign-in-dbc96`, then uses a separate service account to read/write signals in `nextgen-gold`. For deployment, set `MYVIEW_REQUIRE_AUTH=true` and `MYVIEW_CORS_ORIGINS`; route `/api/*` to this Python service. A deployed MT5 service must run where the connected terminal is available. Firebase web API keys are public identifiers; database rules and backend token verification provide access control.

The client-side admin UID list only controls portal navigation. Realtime Database rules and backend verification must be configured with the same UID; do not rely on the client check as the security boundary.

## GitHub Pages deployment

The repository includes `.github/workflows/deploy-pages.yml`. Push to `main` or run the workflow manually to build and deploy only the member site (`/`). The admin site and `marketlab.html` are excluded from this first Pages release; the admin site remains available locally at `/admin.html` and can be added to Pages in a later release. The workflow detects the repository name and configures the correct GitHub Pages subpath automatically.

Before enabling Pages, add these Actions secrets from `website-sign-in-dbc96`: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, and `VITE_FIREBASE_PROFILES_DATABASE_URL`. Add Actions variables `VITE_FIREBASE_ADMIN_UIDS` and `VITE_API_BASE_URL` (the HTTPS origin for the Python/MT5 API, without a trailing slash). Configure the `nextgen-gold` service account on that API host. Add the final `owner.github.io` hostname to Authentication's authorized domains and API `MYVIEW_CORS_ORIGINS`. In GitHub repository settings, enable Pages with **GitHub Actions** as the source.

GitHub Pages cannot host the Python/MT5 API. The API must run on a separate server with MetaTrader 5 connected, Firebase Admin credentials configured, `MYVIEW_REQUIRE_AUTH=true`, and the Pages origin allowed in CORS. Without `VITE_API_BASE_URL`, sign-in pages can load but market candles, session statistics, and signal relay cannot reach the API.

## Windows desktop installer

- The computer running the installed app needs Windows and MetaTrader 5 installed, signed in, and connected to the broker.
- To build the installer from source, use 64-bit Windows, Python 3.10 or newer, and Node.js 20 or newer with npm.
- MT5 terminal path defaults to `C:\Program Files\MetaTrader 5\terminal64.exe`.

From the project root, install the API and packaging dependencies, then build the installer:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r api\requirements.txt
.\.venv\Scripts\python.exe -m pip install pyinstaller==6.22.3
npm ci
npm run build:desktop
```

The Windows installer is created at `release\MyView-Market-Lab-Setup-1.0.0.exe`. Run it and follow the setup prompts; it adds MyView to the Start Menu and creates a desktop shortcut. The installed app starts its bundled local API automatically, so Python and Node.js are not required on the computer where it is installed. MetaTrader 5 must still be installed and connected. MyView reads market data and does not place orders.

To run from source without creating an installer:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r api\requirements.txt
npm install
npm run build
```

Double-click `start-myview.bat` to start the local API and open MyView in the browser at `http://127.0.0.1:8000`. Market data, live signals, and backtests require the API and a connected MT5 terminal.

For development with the Vite server and hot reload, run the backend and frontend separately:

```powershell
# Terminal 1
Set-Location api
..\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2, from the project root
npm run dev
```

The default symbol is `GOLD` for the connected terminal; change it if your broker uses another name (for example, `XAUUSD` or `XAUUSDm`). Set `MT5_PATH` in the environment before starting the API to override the terminal path.

## Data and backtest notes

- The chart API requests MT5 M1 history and aggregates chart bars on UTC epoch boundaries. Strategy levels use separate native MT5 1h/4h history. The chart defaults to a five-month history window; history availability depends on the broker and MT5 terminal's chart-history settings.
- Switch between candlesticks and a closing-price line from the chart toolbar. Chart drawings remain in place when changing timeframes and snap to the nearest bar when the selected interval does not contain the drawing's exact timestamp. Select a drawing, then drag its endpoints to resize it or drag its line/level to move it. Use Fib in the drawing toolbar and drag between two swing points to show Fibonacci retracement levels (0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, and 100%). In fullscreen, drag the chart-tools grip to reposition the floating toolbar and use TOOLS to collapse or expand it.
- Choose a 1-, 2-, or 4-chart layout. Each additional chart has its own timeframe selector and history, crosshairs synchronize to the same nearest time and price across charts, and each chart tile can be resized independently with its corner handle.
- The main chart can share a 3:2 side-by-side layout with an estimated footprint panel; use the Footprint ON/OFF control to show or hide it, with the price chart expanding to the full chart width when it is off. The footprint distributes each chart bar's MT5 tick volume across its price range and estimates the buy/sell split from the candle close location. This is an OHLC/tick-volume visualization, not true bid/ask footprint or order-flow data, so use it as context rather than proof of a liquidity sweep or breakout.
- In chart fullscreen, the eye icon hides or restores the chart header and controls, legend, indicators, and chart time labels; when hidden, the chart panes fill the available screen. The icon remains available while the controls are hidden.
- In fullscreen with the chart controls hidden, the timeframe buttons remain available at the top-right so you can switch chart intervals without restoring the rest of the controls. Enable RSI from the indicator controls to show a separate RSI pane with 30/50/70 guides; its period is adjustable. Confirmed bullish and bearish RSI divergences are marked with red connecting lines on both the price chart and RSI pane.
- Toggle VWAP in the indicator controls to show the daily tick-volume-weighted typical-price VWAP and its upper/lower two-standard-deviation bands. VWAP resets at midnight Asia/Colombo time.
- Toggle SESSIONS to show shaded, dashed range boxes for Asia (06:30–08:30), London (13:30–16:30), New York (19:30–21:30), and IB (18:50–19:50) in Asia/Colombo time, plus dashed horizontal opening-price lines at 04:30 AM (orange, labeled OPEN 18) and 10:30 AM (light).
- Use PD LABELS ON/OFF to show or hide previous-day high/low text while leaving their price lines visible. In fullscreen with controls hidden, use the PD button beside the timeframe buttons.
- The chart displays Asia/Colombo time. Raw MT5 bar timestamps are normalized using `MT5_SERVER_UTC_OFFSET_HOURS` (default `2`, correcting the connected terminal's one-hour chart lag); set that environment variable to your broker server's UTC offset if it differs.
- For a date range that includes today, the chart polls the latest MT5 bars every five seconds and updates the forming candle without resetting chart zoom. Use the AUTO control to pause polling.
- Bar replay starts 100 bars before the end of the loaded history. Use the transport buttons to play, pause, step, choose 1x-10x speed, or drag the replay position; Go live returns to the newest candles.
- MT5 tick volume is displayed; it is not exchange-traded volume or bid/ask order flow.
- Signals use completed M5 candles. Current defaults are an 8-bar liquidity lookback, 5-bar BOS lookback, 5-bar confirmation window, ATR length 14, and 0.10 ATR stop buffer. A bullish setup sweeps below the lowest low of the prior liquidity-lookback bars and closes back above it; a bearish setup sweeps above the prior high and closes back below. Within the confirmation window, BUY requires a close above the previous BOS-lookback high, while SELL requires a close below its low. Opposite-direction sweeps replace the pending setup. These defaults are a preliminary historical-backtest candidate, not a guarantee of future performance. Match the same settings in TradingView when comparing its signals with MyView.
- Signal monitoring starts 30 minutes before each configured Asia/Colombo session and continues through its end: Asia 06:00–08:30, London 13:00–16:30, New York 19:00–21:30, and IB 18:20–19:50. A sweep/BOS outside these scan windows does not produce a signal. New York and IB overlap is kept as two session tags for session statistics.
- Entry is the BOS candle's close. The stop is beyond the sweep candle's extreme by the configured fraction of current M5 ATR (default 0.10). Backtests compare TP1–TP5 (1R–5R) with non-overlapping trades; when a later candle touches both stop and target, stop is counted first. Results are grouped by the session in which the BOS entry occurred.
- When SIGNALS are enabled, the app backfills signals for the selected date range and keeps them in local history. Live monitoring checks completed M5 signals every five seconds using a short rolling window from MT5, without re-fetching the full history on every poll. BUY/SELL entries are marked on the selected chart timeframe. Signals still wait for the M5 candle to close and may appear within five seconds after confirmation; no intrabar or repainting alert is used. The API is read-only and sends no MT5 orders.
- Historical results are a deterministic OHLC simulation, sensitive to broker history, spread, slippage, and the selected sample period; they are not a guarantee of future profitability.
- These rules are a deterministic approximation of the requested price-action concepts, not a guarantee of future results. Backtest results depend on available MT5 history and the broker's configured server UTC offset.
- The API exposes market-data and backtest reads only; no MT5 order placement is implemented.# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
