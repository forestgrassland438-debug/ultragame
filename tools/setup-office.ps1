# LibreOffice Portable stays in the user's application cache; no system-wide install.
$ErrorActionPreference = 'Stop'
$officeCache = Join-Path $env:LOCALAPPDATA 'UltraGameStudio/office'
New-Item -ItemType Directory -Path $officeCache -Force | Out-Null
$officeInstaller = Join-Path $officeCache 'LibreOfficePortable_26.2.4.paf.exe'
$officeHash = '4bde93374aef4409243505b20d16561a4628ac7591457dd01fc6e1ccf571ba65'
if (!(Test-Path -LiteralPath $officeInstaller)) {
  Invoke-WebRequest -Uri 'https://download.documentfoundation.org/libreoffice/portable/26.2.4/LibreOfficePortable_26.2.4_MultilingualStandard.paf.exe' -OutFile $officeInstaller
}
if ((Get-FileHash -LiteralPath $officeInstaller -Algorithm SHA256).Hash.ToLowerInvariant() -ne $officeHash) { throw 'La descarga no coincide con la firma SHA-256 publicada por The Document Foundation.' }
$officeProcess = Start-Process -FilePath $officeInstaller -ArgumentList @('/S', "/D=$officeCache/LibreOfficePortable") -WindowStyle Hidden -PassThru -Wait
if ($officeProcess.ExitCode -ne 0) { throw 'LibreOffice Portable no pudo instalarse.' }
if (!(Test-Path -LiteralPath (Join-Path $officeCache 'LibreOfficePortable/App/libreoffice/program/soffice.exe'))) { throw 'No se encontró soffice.exe después de la instalación.' }
Write-Output 'Conversión local DOC/RTF/Office lista para UltraGame Studio.'
