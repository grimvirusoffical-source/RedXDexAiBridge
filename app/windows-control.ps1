$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if (-not $request.action) { throw 'Missing native action' }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RedXNative {
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
        public int dx; public int dy; public uint mouseData; public uint dwFlags;
        public uint time; public UIntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
        public ushort wVk; public ushort wScan; public uint dwFlags;
        public uint time; public UIntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)] public struct UNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION U; }
    [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    public static void Mouse(uint flags, int data) {
        INPUT i = new INPUT(); i.type = 0; i.U.mi.dwFlags = flags; i.U.mi.mouseData = unchecked((uint)data);
        if (SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))) != 1)
            throw new InvalidOperationException("Windows blocked input. Secure or elevated desktops cannot be controlled by an ordinary app.");
    }
    public static void Key(ushort key, ushort scan, uint flags) {
        INPUT i = new INPUT(); i.type = 1; i.U.ki.wVk = key; i.U.ki.wScan = scan; i.U.ki.dwFlags = flags;
        if (SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))) != 1)
            throw new InvalidOperationException("Windows blocked keyboard input; check the active desktop and application integrity level.");
    }
}
'@
    try { [void][RedXNative]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {}
    if ($request.action -eq 'status') {
        @{ platform='win32'; accessibility=[Environment]::UserInteractive; inputSupported=[Environment]::UserInteractive; screenCount=[RedXNative]::GetSystemMetrics(80); message='Input operates on the current interactive desktop. UAC, lock screens and higher-integrity windows are not bypassed.' } | ConvertTo-Json -Compress
        exit 0
    }
    if (-not [Environment]::UserInteractive) { throw 'An interactive Windows desktop session is required' }
    function Move-To([double]$x, [double]$y) {
        if ([double]::IsNaN($x) -or [double]::IsInfinity($x) -or [math]::Abs($x) -gt 50000 -or [double]::IsNaN($y) -or [double]::IsInfinity($y) -or [math]::Abs($y) -gt 50000) { throw 'Invalid desktop coordinates' }
        if (-not [RedXNative]::SetCursorPos([int]$x, [int]$y)) { throw 'Windows denied pointer positioning' }
    }
    switch ($request.action) {
        'move' { Move-To $request.x $request.y }
        'click' {
            Move-To $request.x $request.y
            $count = 1; if ($null -ne $request.count) { $count = [int]$request.count }
            if ($count -notin @(1,2)) { throw 'Click count must be 1 or 2' }
            $down = 2; $up = 4
            if ($request.button -eq 'right') { $down=8; $up=16 }
            for ($n=0; $n -lt $count; $n++) { [RedXNative]::Mouse($down,0); [RedXNative]::Mouse($up,0); Start-Sleep -Milliseconds 70 }
        }
        'drag' {
            Move-To $request.x $request.y
            [RedXNative]::Mouse(2,0)
            try {
                for ($n=1; $n -le 20; $n++) {
                    Move-To ($request.x + ($request.toX-$request.x)*$n/20) ($request.y + ($request.toY-$request.y)*$n/20)
                    Start-Sleep -Milliseconds 12
                }
            } finally { [RedXNative]::Mouse(4,0) }
        }
        'scroll' {
            $dx=[int]$request.dx; $dy=[int]$request.dy
            if ([math]::Abs([long]$dx) -gt 10000 -or [math]::Abs([long]$dy) -gt 10000) { throw 'Scroll limit exceeded' }
            if ($dy -ne 0) { [RedXNative]::Mouse(0x0800,$dy) }
            if ($dx -ne 0) { [RedXNative]::Mouse(0x1000,$dx) }
        }
        'type' {
            $value=[string]$request.text
            if ($value.Length -gt 8000) { throw 'Text exceeds 8000 UTF-16 units' }
            foreach ($character in $value.ToCharArray()) {
                [RedXNative]::Key(0,[uint16]$character,4)
                [RedXNative]::Key(0,[uint16]$character,6)
            }
        }
        'key' {
            $key=([string]$request.key).ToLowerInvariant()
            $keys=@{enter=13;tab=9;space=32;backspace=8;escape=27;left=37;up=38;right=39;down=40;delete=46;home=36;end=35;pageup=33;pagedown=34}
            if ($key -match '^[a-z0-9]$') { $code=[int][char]$key.ToUpperInvariant() }
            elseif ($keys.ContainsKey($key)) { $code=$keys[$key] }
            elseif ($key -match '^f([1-9]|1[0-2])$') { $code=111+[int]$Matches[1] }
            else { throw 'Unsupported key' }
            $mods=@{command=91;control=17;option=18;shift=16}; $pressed=New-Object 'System.Collections.Generic.List[int]'
            try {
                foreach ($m in @($request.modifiers)) {
                    if (-not $mods.ContainsKey([string]$m)) { throw 'Unsupported modifier' }
                    [RedXNative]::Key([uint16]$mods[$m],0,0); $pressed.Add($mods[$m])
                }
                [RedXNative]::Key([uint16]$code,0,0); [RedXNative]::Key([uint16]$code,0,2)
            } finally { for ($n=$pressed.Count-1; $n -ge 0; $n--) { [RedXNative]::Key([uint16]$pressed[$n],0,2) } }
        }
        'launch' {
            $name=[string]$request.name
            if ($name -notmatch '^[a-zA-Z0-9 ._-]{1,100}$' -or $name.StartsWith('-')) { throw 'Invalid application name' }
            Start-Process -FilePath $name | Out-Null
        }
        default { throw 'Unsupported native action' }
    }
    @{ok=$true;action=$request.action} | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
