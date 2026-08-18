# Run this yourself in your own PowerShell window (not through Claude).
# Asks for your wallet's private key with the input hidden (like a password
# box), then saves it into .env - it's never shown on screen or sent anywhere.

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    Copy-Item (Join-Path $PSScriptRoot ".env.example") $envPath
}

$secure = Read-Host "Paste your wallet's private key (input hidden)" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$plain = $plain.Trim()
if ($plain -notmatch '^(0x)?[0-9a-fA-F]{64}$') {
    Write-Host "That doesn't look like a valid private key (should be 64 hex characters, optionally starting with 0x). Nothing was saved." -ForegroundColor Red
    exit 1
}
if ($plain -notmatch '^0x') { $plain = "0x$plain" }

$lines = Get-Content $envPath
$found = $false
$newLines = $lines | ForEach-Object {
    if ($_ -match '^PRIVATE_KEY=') {
        $found = $true
        "PRIVATE_KEY=$plain"
    } else {
        $_
    }
}
if (-not $found) { $newLines += "PRIVATE_KEY=$plain" }
Set-Content -Path $envPath -Value $newLines -Encoding utf8

Write-Host "Saved to .env. You can close this window." -ForegroundColor Green
