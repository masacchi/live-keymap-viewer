/**
 * scripts/diag/hid-probe.ps1をWSLからWindowsのPowerShellで動かす。
 * 使い方はhid-probe.ps1の先頭を参照。WSL専用。
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'hid-probe.ps1')
const windowsPath = execFileSync('wslpath', ['-w', script]).toString().trim()
const vendorId = process.argv[2] ?? 'e118'

// /mnt/cから呼ぶ(WSL側のディレクトリだとUNCパスの警告が出る)
execFileSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', windowsPath, '-VendorId', vendorId],
  { cwd: '/mnt/c', stdio: 'inherit' }
)
