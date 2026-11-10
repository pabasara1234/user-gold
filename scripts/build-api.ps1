$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
$entry = Join-Path $root 'api\desktop_api.py'
$frontend = Join-Path $root 'dist'
$output = Join-Path $root 'build\backend'
$work = Join-Path $root 'build\pyinstaller'
$spec = Join-Path $root 'build\pyinstaller'

if (-not (Test-Path $python)) {
    throw "Project Python environment not found: $python"
}
if (-not (Test-Path (Join-Path $frontend 'index.html'))) {
    throw 'Built frontend not found. Run npm run build first.'
}

& $python -m PyInstaller `
    --noconfirm `
    --clean `
    --onedir `
    --name MyViewApi `
    --distpath $output `
    --workpath $work `
    --specpath $spec `
    --add-data "$frontend;dist" `
    --collect-all MetaTrader5 `
    --collect-all firebase_admin `
    --collect-all google.auth `
    --collect-all fastapi `
    --collect-all starlette `
    --collect-all uvicorn `
    --collect-all pydantic `
    --collect-all pywebpush `
    --collect-all py_vapid `
    --hidden-import uvicorn.logging `
    --hidden-import uvicorn.loops.auto `
    --hidden-import uvicorn.protocols.http.auto `
    --hidden-import uvicorn.protocols.websockets.auto `
    --hidden-import uvicorn.lifespan.on `
    --hidden-import uvicorn.lifespan.off `
    $entry

if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
}

$executable = Join-Path $output 'MyViewApi\MyViewApi.exe'
if (-not (Test-Path $executable)) {
    throw "Bundled API executable was not created: $executable"
}
Write-Host "Bundled API: $executable"
