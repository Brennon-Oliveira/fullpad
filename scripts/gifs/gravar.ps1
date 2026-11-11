# Grava uma cena do Fullpad que já está aberto (Windows): executa passos de teclado e mouse e captura
# quadros só do retângulo da janela do app (captura de tela: o PrintWindow devolve quadros rasgados com
# o WebView2), com o cursor e os cliques desenhados por cima. Não muda o tamanho nem o estado da
# janela. Chamado por gravar.sh.
#   -Dir    pasta (Windows) dos quadros fNNNN.jpg e de tempos.txt
#   -Steps  passos separados por "|". Coordenadas em pixels DA JANELA (o quadro capturado):
#             c:ctrl+shift+p   acorde de teclas por scancode (gera event.code certo, como teclado de verdade)
#             u:texto          digita texto sem gravar quadros (para navegar até a aba)
#             t:texto          digita texto gravando um quadro por letra
#             p:x,y            põe o cursor em x,y de uma vez
#             g:x,y            desliza o cursor até x,y (0,5 s, gravando)
#             k / K / R        clique, duplo clique, clique direito (onde o cursor está)
#             D / U            aperta / solta o botão esquerdo (arrastar: D, g..., U)
#             h:3 / h:-3       roda do mouse 3 cliques para cima / baixo
#             q:1.5            espera 1,5 s sem gravar
#             w:1.5            espera 1,5 s gravando quadros
#             r / x            liga / desliga a gravação (nada é capturado antes do `r`)
#             s                um quadro
# Segurança:
#   * antes de cada tecla ou clique confere que o Fullpad está em foco e, se não estiver, ABORTA sem
#     enviar nada. O Windows só deixa o app ir para a frente se a pessoa clicar nele: o script espera
#     60 s por isso.
#   * se a pessoa MEXER O MOUSE no meio da cena (o cursor não está onde o script o deixou), aborta e
#     solta o botão, se estiver apertado. Mexer o mouse é o jeito de interromper.
param([string]$Dir, [string]$Steps, [double]$Fps = 8)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public U u; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out PT p);
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
  // flags: 2 esq. baixo, 4 esq. cima, 8 dir. baixo, 16 dir. cima, 0x800 roda
  public static void Mouse(uint flags, int data) {
    INPUT[] a = new INPUT[1]; a[0].type = 0; a[0].u.mi.flags = flags; a[0].u.mi.data = (uint)data;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@
[W]::SetProcessDPIAware() | Out-Null
$scan = @{ esc=0x01; tab=0x0F; enter=0x1C; space=0x39; ctrl=0x1D; shift=0x2A; alt=0x38; backspace=0x0E; delete=0xE053;
  up=0xE048; down=0xE050; left=0xE04B; right=0xE04D; pageup=0xE049; pagedown=0xE051; home=0xE047; end=0xE04F;
  '1'=0x02; '2'=0x03; '3'=0x04; '4'=0x05; '5'=0x06; '6'=0x07; '7'=0x08; '8'=0x09; '9'=0x0A; '0'=0x0B; '='=0x0D; '-'=0x0C;
  backslash=0x2B; f5=0x3F;
  q=0x10; w=0x11; e=0x12; r=0x13; t=0x14; y=0x15; u=0x16; i=0x17; o=0x18; p=0x19;
  a=0x1E; s=0x1F; d=0x20; f=0x21; g=0x22; h=0x23; j=0x24; k=0x25; l=0x26; z=0x2C; x=0x2D; c=0x2E; v=0x2F; b=0x30; n=0x31; m=0x32 }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Get-ChildItem $Dir -Filter 'f*.*' | Remove-Item -Force
$jpg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$jpgp = New-Object System.Drawing.Imaging.EncoderParameters 1
$jpgp.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 92L
$p = Get-Process fullpad | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$h = $p.MainWindowHandle
# espera a pessoa dar foco ao app (sem restaurar/maximizar: a janela fica como ela deixou)
if ([W]::GetForegroundWindow() -ne $h) {
  (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null
  $lim = [Diagnostics.Stopwatch]::StartNew()
  while ([W]::GetForegroundWindow() -ne $h -and $lim.Elapsed.TotalSeconds -lt 60) { Start-Sleep -Milliseconds 250 }
}
Start-Sleep -Milliseconds 500
if ([W]::GetForegroundWindow() -ne $h) { throw "o Fullpad não está em foco: abortei sem enviar nada" }
$n = 0
$t0 = [Diagnostics.Stopwatch]::StartNew()
$tempos = New-Object System.Collections.Generic.List[string]
$rec = $false
$botao = $false                 # botão esquerdo apertado por este script
$esperado = $null               # onde o cursor deveria estar (para detectar mouse mexido)
$ultimoClique = $null; $cliqueEm = -9999
$rect = New-Object W+RECT
[W]::GetWindowRect($h, [ref]$rect) | Out-Null

function CursorAbs { $q = New-Object W+PT; [W]::GetCursorPos([ref]$q) | Out-Null; return $q }
function ConferirMouse {
  if ($script:esperado -ne $null) {
    $q = CursorAbs
    if ([Math]::Abs($q.X - $script:esperado.X) -gt 8 -or [Math]::Abs($q.Y - $script:esperado.Y) -gt 8) { throw "o mouse foi mexido: abortei" }
  }
}
function Mover([int]$x, [int]$y) {
  $ax = $script:rect.L + $x; $ay = $script:rect.T + $y
  [W]::SetCursorPos($ax, $ay) | Out-Null
  $pt = New-Object W+PT; $pt.X = $ax; $pt.Y = $ay; $script:esperado = $pt
}
function Shot {
  if (-not $script:rec) { return }
  $r = New-Object W+RECT
  [W]::GetWindowRect($h, [ref]$r) | Out-Null
  $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  # captura de tela só do retângulo da janela (PrintWindow devolve quadros rasgados com o WebView2)
  $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
  # cursor e clique, desenhados por cima (a captura de tela não leva o cursor)
  $q = CursorAbs; $cx = $q.X - $r.L; $cy = $q.Y - $r.T
  if ($cx -ge 0 -and $cy -ge 0 -and $cx -lt $bmp.Width -and $cy -lt $bmp.Height) {
    $g.SmoothingMode = 'AntiAlias'
    if ($script:t0.ElapsedMilliseconds - $script:cliqueEm -lt 380) {
      $dt = ($script:t0.ElapsedMilliseconds - $script:cliqueEm) / 380.0; $rad = 14 + 26 * $dt
      $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb([int](230 * (1 - $dt)), 255, 196, 0)), 5
      $g.DrawEllipse($pen, [float]($cx - $rad), [float]($cy - $rad), [float](2 * $rad), [float](2 * $rad)); $pen.Dispose()
    }
    $pts = @(@(0,0),@(0,27),@(7,21),@(12,32),@(17,30),@(12,20),@(21,20)) | ForEach-Object { New-Object System.Drawing.PointF ([float]($cx + $_[0] * 1.15)), ([float]($cy + $_[1] * 1.15)) }
    $g.FillPolygon([System.Drawing.Brushes]::White, [System.Drawing.PointF[]]$pts)
    $pen2 = New-Object System.Drawing.Pen ([System.Drawing.Color]::Black), 2; $g.DrawPolygon($pen2, [System.Drawing.PointF[]]$pts); $pen2.Dispose()
  }
  $g.Dispose()
  $script:n++
  $bmp.Save((Join-Path $Dir ("f{0:D4}.jpg" -f $script:n)), $script:jpg, $script:jpgp)
  $bmp.Dispose()
  $script:tempos.Add([string]$script:t0.ElapsedMilliseconds)
}
function Esperar([double]$seg) {
  $fim = $t0.ElapsedMilliseconds + [int]($seg * 1000)
  while ($t0.ElapsedMilliseconds -lt $fim) {
    $ini = $t0.ElapsedMilliseconds; Shot
    $resto = (1000 / $Fps) - ($t0.ElapsedMilliseconds - $ini); if ($resto -gt 0) { Start-Sleep -Milliseconds ([int]$resto) }
  }
}
function Chord([string]$spec) {
  $keys = $spec.ToLower().Split('+')
  foreach ($k in $keys) { if (-not $scan.ContainsKey($k)) { throw "tecla desconhecida: $k" } }
  foreach ($k in $keys) { $c = [int]$scan[$k]; [W]::Key([uint16]($c -band 0xFF), (($c -band 0xFF00) -ne 0), $false); Start-Sleep -Milliseconds 25 }
  Start-Sleep -Milliseconds 60
  [array]::Reverse($keys)
  foreach ($k in $keys) { $c = [int]$scan[$k]; [W]::Key([uint16]($c -band 0xFF), (($c -band 0xFF00) -ne 0), $true); Start-Sleep -Milliseconds 25 }
}
function Clicar([uint32]$baixo, [uint32]$cima) {
  $script:ultimoClique = CursorAbs; $script:cliqueEm = $script:t0.ElapsedMilliseconds
  [W]::Mouse($baixo, 0); Start-Sleep -Milliseconds 70; [W]::Mouse($cima, 0)
}
function Deslizar([int]$x, [int]$y) {
  $q = CursorAbs; $x0 = $q.X - $script:rect.L; $y0 = $q.Y - $script:rect.T
  $passos = 14
  for ($i = 1; $i -le $passos; $i++) {
    $t = $i / $passos; $e = $t * $t * (3 - 2 * $t)   # suaviza começo e fim
    Mover ([int]($x0 + ($x - $x0) * $e)) ([int]($y0 + ($y - $y0) * $e))
    Shot; Start-Sleep -Milliseconds 18
  }
}
try {
  foreach ($s in ($Steps -split '\|')) {
    $kind = $s.Substring(0, 1); $arg = if ($s.Length -gt 2) { $s.Substring(2) } else { "" }
    if ($kind -cin 'c', 't', 'u', 'p', 'g', 'k', 'K', 'R', 'D', 'U', 'h') {
      # arrastando uma aba o app cria uma janela-sombra e o foco muda por um instante: aí não vale
      if (-not $script:botao -and [W]::GetForegroundWindow() -ne $h) { throw "perdeu o foco: abortei" }
      if ($kind -cin 'g', 'k', 'K', 'R', 'D', 'U', 'h') { ConferirMouse }
    }
    if ($kind -cin 'k', 'K', 'R', 'D', 'h' -and $script:esperado -eq $null) { throw "falta um p: ou g: antes de clicar (o clique cairia onde o mouse estiver)" }
    switch -casesensitive ($kind) {
      'r' { $script:rec = $true }
      'x' { $script:rec = $false }
      'u' { foreach ($ch in $arg.ToCharArray()) { [W]::Uni($ch); Start-Sleep -Milliseconds 60 } }
      'q' { Start-Sleep -Milliseconds ([int]([double]$arg * 1000)) }
      'c' { Chord $arg }
      't' { foreach ($ch in $arg.ToCharArray()) { [W]::Uni($ch); Start-Sleep -Milliseconds 110; Shot } }
      's' { Shot }
      'w' { Esperar ([double]$arg) }
      'p' { $xy = $arg.Split(','); Mover ([int]$xy[0]) ([int]$xy[1]) }
      'g' { $xy = $arg.Split(','); Deslizar ([int]$xy[0]) ([int]$xy[1]) }
      'k' { Clicar 2 4 }
      'K' { Clicar 2 4; Start-Sleep -Milliseconds 90; Clicar 2 4 }
      'R' { Clicar 8 16 }
      'D' { $script:botao = $true; [W]::Mouse(2, 0); Start-Sleep -Milliseconds 120 }
      'U' { [W]::Mouse(4, 0); $script:botao = $false; Start-Sleep -Milliseconds 150 }
      'h' { [W]::Mouse(0x800, [int]([double]$arg * 120)); Start-Sleep -Milliseconds 120 }
    }
  }
} finally {
  if ($botao) { [W]::Mouse(4, 0) }   # nunca deixa o botão apertado
}
Set-Content -Path (Join-Path $Dir 'tempos.txt') -Value ($tempos -join "`n")
"$n quadros em $($t0.ElapsedMilliseconds) ms"
