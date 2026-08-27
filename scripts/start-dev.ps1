$env:PORT='19773'
$env:BASE_PATH='/'
$p = Start-Process -FilePath 'C:\Program Files\nodejs\corepack.cmd' -ArgumentList 'pnpm','--filter','@workspace/quantum-ai','run','dev' -WorkingDirectory 'D:\Quantum-Trading-Engine' -RedirectStandardOutput 'D:\Quantum-Trading-Engine\.freebuff\preview-257ae47b-62d8-471f-8675-074568abb3ee.log' -RedirectStandardError 'D:\Quantum-Trading-Engine\.freebuff\preview-257ae47b-62d8-471f-8675-074568abb3ee.log.err' -WindowStyle Hidden -PassThru
Write-Output $p.Id
