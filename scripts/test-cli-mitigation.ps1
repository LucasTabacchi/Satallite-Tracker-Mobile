param([switch]$Baseline)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$docker = (Get-Command docker.exe -ErrorAction Stop).Source
$engine = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$image = 'sha256:0d97e39c6fda148bd21ec8f47728a1ecc752816a5800e50bd65d14c4555097ca'
# An explicitly local, already-cached image; this runner never pulls or installs.
& $docker --host $engine image inspect $image *> $null
if ($LASTEXITCODE -ne 0) { throw 'The approved local image/engine is unavailable. No fallback to host execution.' }
$name = 'tp7-cli-' + [guid]::NewGuid().ToString('N')
$logs = Join-Path ([IO.Path]::GetTempPath()) $name
New-Item -ItemType Directory -Path $logs | Out-Null
$arguments = @('--host', $engine, 'run', '--name', $name,
    '--network', 'none', '--read-only', '--user', '65534:65534',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', '256m', '--memory-swap', '256m', '--cpus', '0.5', '--pids-limit', '32',
    '--ulimit', 'fsize=1048576:1048576', '--ulimit', 'nofile=128:128', '--ulimit', 'cpu=30:30',
    '--tmpfs', '/scratch:rw,noexec,nosuid,nodev,size=32m,mode=1777', '--ipc', 'none', '--log-driver', 'none')
$mounts = @{
    '/work/scripts' = $PSScriptRoot
    '/work/tests/cli-output-budget.test.cjs' = (Join-Path $project 'tests\cli-output-budget.test.cjs')
    '/work/tests/dependency-security.test.cjs' = (Join-Path $project 'tests\dependency-security.test.cjs')
    '/work/package-lock.json' = (Join-Path $project 'package-lock.json')
    '/deps/cli' = (Join-Path $project 'node_modules\expo\node_modules\@expo\cli')
    '/deps/node_modules' = (Join-Path $project 'node_modules')
}
foreach ($target in $mounts.Keys) {
    $source = (Resolve-Path -LiteralPath $mounts[$target]).Path
    if ($source.Contains(',') -or $source.Contains('"')) { throw 'Unsupported mount path characters.' }
    $arguments += @('--mount', "type=bind,source=$source,target=$target,readonly")
}
$arguments += @('--entrypoint', '/usr/bin/env', $image, '-i', 'PATH=/usr/bin:/bin',
    'HOME=/scratch', 'TMPDIR=/scratch', 'TZ=UTC', 'TP7_CLI_FIXTURE=/deps/cli', 'TP7_DEPENDENCY_ROOT=/work')
if ($Baseline) { $arguments += 'TP7_CLI_BASELINE=1' }
$arguments += @('/usr/bin/node', '--max-old-space-size=128', '--test', '/work/tests/cli-output-budget.test.cjs', '/work/tests/dependency-security.test.cjs')
$quoted = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
$exitCode = 1
try {
    $process = Start-Process -FilePath $docker -ArgumentList $quoted -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput "$logs\stdout.txt" -RedirectStandardError "$logs\stderr.txt"
    if (-not $process.WaitForExit(60000)) { throw 'Isolated CLI tests exceeded the 60-second wall-clock limit.' }
    $process.Refresh()
    $exitCode = $process.ExitCode
    Get-Content -LiteralPath "$logs\stdout.txt"
    Get-Content -LiteralPath "$logs\stderr.txt"
} finally {
    # Only this uniquely named local container; never enumerate or stop other containers.
    & $docker --host $engine rm --force $name *> $null
    Write-Output "Isolated test logs: $logs"
}
exit $exitCode
