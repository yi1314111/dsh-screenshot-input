/**
 * Host half of the screenshot-input bundle.
 *
 * Registers one private HTTP route the browser half calls to start a Windows
 * screen snip — the same overlay Win+Shift+S opens. The route presses the
 * chord, waits for a new clipboard image, and answers with its PNG bytes. The
 * browser half turns those bytes into an ordinary draft image attachment.
 *
 * The route is registered on the local Web carrier, so it is reachable both
 * from a browser page and from the Desktop shell, which forwards application
 * paths to the Host. Requests that did not come from the application origin
 * are refused.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PING_PATH = '/screenshot-input/ping'
const SNIP_PATH = '/screenshot-input/snip'
const CAPTURE_TIMEOUT_SECONDS = 60
const CAPTURE_TIMEOUT_MS = (CAPTURE_TIMEOUT_SECONDS + 15) * 1000

const CAPTURE_SCRIPT = String.raw`param(
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace DshSnip -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
'@

function Get-ForegroundProcessName {
  try {
    $hwnd = [DshSnip.Native]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { return '' }
    $ownerPid = 0
    [void][DshSnip.Native]::GetWindowThreadProcessId($hwnd, [ref]$ownerPid)
    if ($ownerPid -eq 0) { return '' }
    return (Get-Process -Id $ownerPid -ErrorAction Stop).ProcessName
  } catch {
    return ''
  }
}

function Read-ClipboardImage {
  try {
    $image = [System.Windows.Forms.Clipboard]::GetImage()
    if ($null -eq $image) { return $null }
    $stream = New-Object System.IO.MemoryStream
    $image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $image.Dispose()
    $bytes = $stream.ToArray()
    $stream.Dispose()
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '') }
    finally { $sha.Dispose() }
    return [pscustomobject]@{ Hash = $hash; Bytes = $bytes }
  } catch {
    return $null
  }
}

$prior = Read-ClipboardImage
$priorHash = ''
$sequence = [DshSnip.Native]::GetClipboardSequenceNumber()
if ($null -ne $prior) { $priorHash = $prior.Hash }

# Win+Shift+S: the system screen-snip overlay.
[DshSnip.Native]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[DshSnip.Native]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[DshSnip.Native]::keybd_event(0x53, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[DshSnip.Native]::keybd_event(0x53, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[DshSnip.Native]::keybd_event(0x10, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[DshSnip.Native]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)

$snipHost = 'SnippingTool|ScreenClippingHost|ScreenSketch'
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$overlaySeen = $false
$overlayGoneAt = $null
$lastHostCheck = [datetime]::MinValue

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 200
  $now = [DshSnip.Native]::GetClipboardSequenceNumber()
  if ($now -ne $sequence) {
    $sequence = $now
    $current = Read-ClipboardImage
    if ($null -ne $current -and $current.Hash -ne $priorHash) {
      $path = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-snip-' + [guid]::NewGuid().ToString('N') + '.png')
      [System.IO.File]::WriteAllBytes($path, $current.Bytes)
      Write-Output $path
      exit 0
    }
  }

  $stamp = [datetime]::UtcNow
  if (($stamp - $lastHostCheck).TotalMilliseconds -ge 400) {
    $lastHostCheck = $stamp
    $foreground = Get-ForegroundProcessName
    if ($foreground -match $snipHost) {
      $overlaySeen = $true
      $overlayGoneAt = $null
    } elseif ($overlaySeen -and $null -eq $overlayGoneAt) {
      $overlayGoneAt = $stamp
    } elseif ($overlaySeen -and $null -ne $overlayGoneAt -and ($stamp - $overlayGoneAt).TotalMilliseconds -ge 900) {
      # The overlay closed without producing a new clipboard image: the user cancelled.
      exit 3
    }
  }
}

exit 3
`

function resolvePowerShell() {
  if (process.platform !== 'win32') return undefined
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  const windowsPowerShell = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (existsSync(windowsPowerShell)) return windowsPowerShell
  return 'powershell.exe'
}

function writeJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', String(body.length))
  res.end(body)
}

function isLoopbackHostname(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
}

function originAllowed(req, origin) {
  const header = req.headers.origin
  // The Desktop shell forwards application requests without an Origin header.
  if (header === undefined) return true
  if (header === 'dsh-app://app') return true
  if (origin === undefined) return false
  try {
    const requested = new URL(header)
    const expected = new URL(origin)
    if (requested.protocol !== expected.protocol) return false
    if (requested.host === expected.host) return true
    return isLoopbackHostname(requested.hostname) && isLoopbackHostname(expected.hostname) && requested.port === expected.port
  } catch (error) {
    return false
  }
}

export function apply(ctx) {
  const shell = resolvePowerShell()
  if (shell === undefined) return
  // A booting composition may still be starting the Web carrier when this
  // plugin activates; waiting for the service keeps the route registered on
  // the first run instead of only after a manual plugin restart.
  ctx.inject(['webServer'], (scope) => mountRoutes(scope, shell))
}

/**
 * Register the capture route on the local Web carrier.
 * @param ctx - context where `webServer` is available.
 * @param shell - resolved Windows PowerShell executable.
 */
function mountRoutes(ctx, shell) {
  const webServer = ctx.webServer
  if (webServer === undefined || webServer === null) return

  let workDir
  let running = null
  let disposed = false

  const start = async () => {
    if (workDir === undefined) workDir = await mkdtemp(join(tmpdir(), 'dsh-screenshot-input-'))
    const scriptPath = join(workDir, 'capture.ps1')
    if (!existsSync(scriptPath)) await writeFile(scriptPath, CAPTURE_SCRIPT, 'utf8')
    return scriptPath
  }

  const capture = async () => {
    const scriptPath = await start()
    return await new Promise((resolve) => {
      const child = spawn(
        shell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-TimeoutSeconds',
          String(CAPTURE_TIMEOUT_SECONDS),
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let stdout = ''
      let stderr = ''
      let settled = false
      let killer
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(killer)
        resolve(value)
      }
      killer = setTimeout(() => {
        try {
          child.kill()
        } catch (error) {
          /* The capture settled on its own. */
        }
        finish({ code: 1, detail: 'capture timed out' })
      }, CAPTURE_TIMEOUT_MS)
      child.stdout.on('data', (chunk) => {
        if (stdout.length < 8192) stdout += chunk.toString('utf8')
      })
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 8192) stderr += chunk.toString('utf8')
      })
      child.on('error', (error) => {
        finish({ code: 1, detail: error.message })
      })
      child.on('close', (code) => {
        const line = stdout
          .split(/\r?\n/u)
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '')
          .pop()
        if (code === 0 && line !== undefined && /\.png$/iu.test(line)) {
          finish({ code: 0, path: line })
          return
        }
        finish({ code: code === 3 ? 3 : 1, detail: stderr.trim() || line || `exit ${String(code)}` })
      })
    })
  }

  const handler = async (req, res) => {
    req.resume()
    const origin = (() => {
      try {
        return webServer.getOrigin()
      } catch (error) {
        return undefined
      }
    })()
    if (!originAllowed(req, origin)) {
      writeJson(res, 403, { error: 'origin' })
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'method' })
      return
    }
    if (disposed) {
      writeJson(res, 503, { error: 'disposed' })
      return
    }
    if (running !== null) {
      writeJson(res, 409, { error: 'busy' })
      return
    }
    running = (async () => {
      const outcome = await capture()
      if (outcome.code === 3) {
        writeJson(res, 408, { error: 'cancelled' })
        return
      }
      if (outcome.code !== 0) {
        console.warn('[screenshot-input] capture failed:', String(outcome.detail ?? '').slice(0, 400))
        writeJson(res, 500, { error: 'failed', detail: String(outcome.detail ?? '').slice(0, 400) })
        return
      }
      let bytes
      try {
        bytes = await readFile(outcome.path)
      } catch (error) {
        writeJson(res, 500, { error: 'read' })
        return
      } finally {
        try {
          await rm(outcome.path, { force: true })
        } catch (error) {
          /* A retained temporary capture is harmless. */
        }
      }
      res.statusCode = 200
      res.setHeader('content-type', 'image/png')
      res.setHeader('cache-control', 'no-store')
      res.setHeader('content-length', String(bytes.length))
      res.end(bytes)
    })()
    try {
      await running
    } finally {
      running = null
    }
  }

  const ping = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      writeJson(res, 405, { error: 'method' })
      return
    }
    writeJson(res, 200, { ok: true, platform: process.platform, shell })
  }

  ctx.effect(() => {
    const disposers = [webServer.register({ kind: 'exact', path: SNIP_PATH, handler })]
    try {
      disposers.push(webServer.register({ kind: 'exact', path: PING_PATH, handler: ping }))
    } catch (error) {
      /* A duplicate diagnostic route must not take the capture route down. */
    }
    return async () => {
      disposed = true
      for (const dispose of disposers) {
        try {
          dispose()
        } catch (error) {
          /* Already removed. */
        }
      }
      if (workDir !== undefined) {
        try {
          await rm(workDir, { recursive: true, force: true })
        } catch (error) {
          /* Best effort. */
        }
      }
    }
  }, 'screenshot-input: snip route')
}
