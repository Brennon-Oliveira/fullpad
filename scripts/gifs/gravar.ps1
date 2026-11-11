# Grava uma cena do Fullpad que já está aberto (Windows): executa passos de teclado e captura quadros
# só do retângulo da janela do app (captura de tela: o PrintWindow devolve quadros rasgados com o
# WebView2). Não usa o mouse e não muda o tamanho nem o estado da janela. Chamado por gravar.sh.
#   -Dir    pasta (Windows) dos quadros fNNNN.jpg e de tempos.txt
#   -Steps  passos separados por "|":
#             c:ctrl+shift+p   acorde de teclas por scancode (gera event.code certo, como teclado de verdade)
#             u:texto          digita texto sem gravar quadros (para navegar até a aba)
#             t:texto          digita texto gravando um quadro por letra
#             q:1.5            espera 1,5 s sem gravar
#             w:1.5            espera 1,5 s gravando quadros
#             r / x            liga / desliga a gravação (nada é capturado antes do `r`)
#             s                um quadro
# Segurança: antes de cada tecla confere que o Fullpad está em foco e, se não estiver, ABORTA sem
# enviar nada (senão as teclas iriam para outra janela). O Windows só deixa o app ir para a frente se
# você clicar nele: o script espera 30 s por isso.
param([string]$Dir, [string]$Steps, [double]$Fps = 8, [switch]$SemFoco)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public U u; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static void Key(ushort scan, bool ext, bool up) {
    INPUT[] a = new INPUT[1]; a[0].type = 1;
    a[0].u.ki.scan = scan; a[0].u.ki.flags = 8u | (ext ? 1u : 0u) | (up ? 2u : 0u);
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Uni(char c) {
    INPUT[] a = new INPUT[2]; a[0].type = 1; a[1].type = 1;
    a[0].u.ki.scan = c; a[0].u.ki.flags = 4; a[1].u.ki.scan = c; a[1].u.ki.flags = 4 | 2;
    SendInput(2, a, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@
[W]::SetProcessDPIAware() | Out-Null
$scan = @{ esc=0x01; tab=0x0F; enter=0x1C; space=0x39; ctrl=0x1D; shift=0x2A; alt=0x38;
  up=0xE048; down=0xE050; left=0xE04B; right=0xE04D; pageup=0xE049; pagedown=0xE051; home=0xE047; end=0xE04F;
  '1'=0x02; '2'=0x03; '3'=0x04; '4'=0x05; '5'=0x06; '6'=0x07; '7'=0x08; '8'=0x09; '9'=0x0A; '0'=0x0B; '='=0x0D; '-'=0x0C;
  q=0x10; w=0x11; e=0x12; r=0x13; t=0x14; y=0x15; u=0x16; i=0x17; o=0x18; p=0x19;
  a=0x1E; s=0x1F; d=0x20; f=0x21; g=0x22; h=0x23; j=0x24; k=0x25; l=0x26; z=0x2C; x=0x2D; c=0x2E; v=0x2F; b=0x30; n=0x31; m=0x32 }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Get-ChildItem $Dir -Filter 'f*.*' | Remove-Item -Force
$jpg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$jpgp = New-Object System.Drawing.Imaging.EncoderParameters 1
$jpgp.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 92L
$p = Get-Process fullpad | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$h = $p.MainWindowHandle
# traz o app para a frente sem restaurar/maximizar (a janela fica como a pessoa deixou)
if ([W]::GetForegroundWindow() -ne $h) {
  (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null
  $lim = [Diagnostics.Stopwatch]::StartNew()
  while ([W]::GetForegroundWindow() -ne $h -and $lim.Elapsed.TotalSeconds -lt 30) { Start-Sleep -Milliseconds 250 }
}
Start-Sleep -Milliseconds 500
if ([W]::GetForegroundWindow() -ne $h) { throw "o Fullpad não está em foco: abortei sem enviar teclas" }
$n = 0
$t0 = [Diagnostics.Stopwatch]::StartNew()
$tempos = New-Object System.Collections.Generic.List[string]
$rec = $false
function Shot {
  if (-not $script:rec) { return }
  $r = New-Object W+RECT
  [W]::GetWindowRect($h, [ref]$r) | Out-Null
  $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  # captura de tela só do retângulo da janela (PrintWindow devolve quadros rasgados com o WebView2)
  $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size); $g.Dispose()
  $script:n++
  $bmp.Save((Join-Path $Dir ("f{0:D4}.jpg" -f $script:n)), $script:jpg, $script:jpgp)
  $bmp.Dispose()
  $script:tempos.Add([string]$script:t0.ElapsedMilliseconds)
}
function Chord([string]$spec) {
  $keys = $spec.ToLower().Split('+')
  foreach ($k in $keys) { if (-not $scan.ContainsKey($k)) { throw "tecla desconhecida: $k" } }
  foreach ($k in $keys) { $c = [int]$scan[$k]; [W]::Key([uint16]($c -band 0xFF), (($c -band 0xFF00) -ne 0), $false); Start-Sleep -Milliseconds 25 }
  Start-Sleep -Milliseconds 60
  [array]::Reverse($keys)
  foreach ($k in $keys) { $c = [int]$scan[$k]; [W]::Key([uint16]($c -band 0xFF), (($c -band 0xFF00) -ne 0), $true); Start-Sleep -Milliseconds 25 }
}
foreach ($s in ($Steps -split '\|')) {
  $kind = $s.Substring(0, 1); $arg = if ($s.Length -gt 2) { $s.Substring(2) } else { "" }
  if ($kind -in 'c', 't', 'u' -and [W]::GetForegroundWindow() -ne $h) { throw "perdeu o foco: abortei" }
  switch ($kind) {
    'r' { $script:rec = $true }
    'x' { $script:rec = $false }
    'u' { foreach ($ch in $arg.ToCharArray()) { [W]::Uni($ch); Start-Sleep -Milliseconds 60 } }
    'q' { Start-Sleep -Milliseconds ([int]([double]$arg * 1000)) }
    'c' { Chord $arg }
    't' { foreach ($ch in $arg.ToCharArray()) { [W]::Uni($ch); Start-Sleep -Milliseconds 110; Shot } }
    's' { Shot }
    'w' {
      $fim = $t0.ElapsedMilliseconds + [int]([double]$arg * 1000)
      while ($t0.ElapsedMilliseconds -lt $fim) { $ini = $t0.ElapsedMilliseconds; Shot; $resto = (1000 / $Fps) - ($t0.ElapsedMilliseconds - $ini); if ($resto -gt 0) { Start-Sleep -Milliseconds ([int]$resto) } }
    }
  }
}
Set-Content -Path (Join-Path $Dir 'tempos.txt') -Value ($tempos -join "`n")
"$n quadros em $($t0.ElapsedMilliseconds) ms"
