# =============================================================================
# serve.ps1 — a tiny static file server for local development
# -----------------------------------------------------------------------------
# Science Maps is a pure static site that uses native ES modules (import/export).
# Browsers refuse to load ES modules from the file:// protocol, so you need to
# open the app over http://. This script is a dependency-free way to do that on
# Windows (no Node or Python required) using the built-in .NET HttpListener.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File serve.ps1            # serves . on 8137
#   powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 9000
#
# Then open the printed URL (e.g. http://localhost:8137/) in your browser.
# Press Ctrl+C in this window to stop the server.
# =============================================================================
param(
  [int]$Port = 8137,
  [string]$Root = $PSScriptRoot
)

$Root = (Resolve-Path $Root).Path

# Map file extensions to MIME types. The .js -> text/javascript line is the
# important one: ES modules are only executed when served with a JavaScript
# MIME type.
$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".htm"  = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".mjs"  = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".gif"  = "image/gif"
  ".ico"  = "image/x-icon"
  ".webp" = "image/webp"
  ".txt"  = "text/plain; charset=utf-8"
  ".map"  = "application/json; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Host "ERROR: could not start server on $prefix"
  Write-Host $_.Exception.Message
  exit 1
}

Write-Host "Science Maps dev server"
Write-Host "Serving: $Root"
Write-Host "Open:    $prefix"
Write-Host "(Press Ctrl+C to stop)"

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
  } catch {
    break
  }

  $request = $context.Request
  $response = $context.Response

  try {
    # Close the connection after each response. This little static server handles
    # one request at a time, and keep-alive connections can make a browser's
    # parallel resource requests stall behind each other. Closing connections
    # keeps it reliably responsive.
    $response.KeepAlive = $false

    # Decode %20 etc., drop any query string, and default "/" to index.html.
    $path = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
    if ($path -eq "/" -or [string]::IsNullOrEmpty($path)) { $path = "/index.html" }

    $relative = $path.TrimStart("/")
    $full = Join-Path $Root $relative

    if (Test-Path $full -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      if ($mime.ContainsKey($ext)) { $response.ContentType = $mime[$ext] }
      # Allow the local page to call third-party APIs without surprises.
      $response.Headers.Add("Cache-Control", "no-store")
      $response.StatusCode = 200
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
      $response.OutputStream.Write($msg, 0, $msg.Length)
    }
  } catch {
    try { $response.StatusCode = 500 } catch {}
  } finally {
    try { $response.OutputStream.Close() } catch {}
  }
}
