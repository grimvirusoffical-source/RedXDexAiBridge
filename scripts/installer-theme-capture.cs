// CI only: captures this fixture's window and reads controls. No mouse or keyboard input.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
class InstallerThemeCapture {
 delegate bool EnumProc(IntPtr window, IntPtr data);
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr data);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr window);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder text,int size);
 [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window,int message,IntPtr wParam,IntPtr lParam);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageW")] static extern IntPtr ReadControlText(IntPtr window,int message,IntPtr length,StringBuilder text);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect rect);
 [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window,IntPtr dc,uint flags);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 static string Hash(Bitmap bitmap) {
   var data=bitmap.LockBits(new Rectangle(0,0,bitmap.Width,bitmap.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
   // GDI window captures do not define alpha; compare only the displayed RGB values.
   try { var raw=new byte[Math.Abs(data.Stride)*data.Height];Marshal.Copy(data.Scan0,raw,0,raw.Length);var rgb=new byte[bitmap.Width*bitmap.Height*3];int next=0;for(int y=0;y<bitmap.Height;y++)for(int x=0;x<bitmap.Width;x++){int offset=y*Math.Abs(data.Stride)+x*4;rgb[next++]=raw[offset];rgb[next++]=raw[offset+1];rgb[next++]=raw[offset+2];}using(var sha=SHA256.Create())return Convert.ToBase64String(sha.ComputeHash(rgb)); }
   finally { bitmap.UnlockBits(data); }
 }
 static Bitmap Capture(IntPtr window) {
   Rect rect;GetWindowRect(window,out rect);var image=new Bitmap(rect.Right-rect.Left,rect.Bottom-rect.Top,PixelFormat.Format32bppArgb);
   bool printed;using(var graphics=Graphics.FromImage(image)){var dc=graphics.GetHdc();try{printed=PrintWindow(window,dc,2);}finally{graphics.ReleaseHdc(dc);}}
   if(!printed){image.Dispose();throw new Exception("Window capture failed.");}
   var data=image.LockBits(new Rectangle(0,0,image.Width,image.Height),ImageLockMode.ReadWrite,PixelFormat.Format32bppArgb);
   try{var bytes=new byte[Math.Abs(data.Stride)*data.Height];Marshal.Copy(data.Scan0,bytes,0,bytes.Length);for(int y=0;y<data.Height;y++)for(int x=0;x<image.Width;x++)bytes[y*Math.Abs(data.Stride)+x*4+3]=255;Marshal.Copy(bytes,0,data.Scan0,bytes.Length);}finally{image.UnlockBits(data);}
   return image;
 }
 static int Main(string[] args) {
   if(Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true"||Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT")!="github-hosted"||(args.Length!=3&&args.Length!=4)) { Console.Error.WriteLine("CI runner only."); return 1; }
   bool fallback=args.Length==4&&args[3]=="fallback";
   bool terminate=args.Length==4&&args[3]=="terminate",requireArt=!fallback,helperKilled=false;
   Process process=null;var helpers=new HashSet<int>();
   try {
     SetProcessDPIAware();
     var canonical=new Dictionary<string,int>();
     using(var sprite=new Bitmap(args[1])) for(int i=0;i<=100;i++)using(var frame=sprite.Clone(new Rectangle(0,i*232,200,232),PixelFormat.Format32bppArgb))canonical[Hash(frame)]=i;
     Directory.CreateDirectory(args[2]);
     var start=new ProcessStartInfo(args[0]) { UseShellExecute=false };
     start.EnvironmentVariables["REDX_INSTALLER_THEME_DIAGNOSTICS"]=Path.Combine(args[2],"drawing-helper.log");
     process=Process.Start(start);
     var positions=new HashSet<int>(); var frames=new HashSet<int>(); var statuses=new HashSet<string>();
     int snapshots=0,samples=0,fallbackSamples=0; var lines=new List<string>(); var watch=Stopwatch.StartNew();
     while(!process.HasExited&&watch.ElapsedMilliseconds<20000) {
       IntPtr window=IntPtr.Zero;
       EnumWindows(delegate(IntPtr candidate,IntPtr ignored) { uint id; GetWindowThreadProcessId(candidate,out id); if(id==(uint)process.Id&&IsWindowVisible(candidate)){window=candidate;return false;}return true; },IntPtr.Zero);
       if(window!=IntPtr.Zero) {
         IntPtr progress=IntPtr.Zero,art=IntPtr.Zero,status=IntPtr.Zero;
         EnumChildWindows(window,delegate(IntPtr child,IntPtr ignored) {
           int id=GetDlgCtrlID(child); if(id==1004)progress=child; if(id==1006)status=child;
           var className=new StringBuilder(256);GetClassName(child,className,className.Capacity);Rect bounds;GetWindowRect(child,out bounds);
           if(String.Equals(className.ToString(),"Static",StringComparison.OrdinalIgnoreCase)&&id==0&&bounds.Right-bounds.Left==200&&bounds.Bottom-bounds.Top==232)art=child;
           return true;
         },IntPtr.Zero);
         if(progress!=IntPtr.Zero&&(fallback||(art!=IntPtr.Zero&&IsWindowVisible(art)))) {
           int low=SendMessage(progress,0x0407,new IntPtr(1),IntPtr.Zero).ToInt32(),high=SendMessage(progress,0x0407,IntPtr.Zero,IntPtr.Zero).ToInt32(),pos=SendMessage(progress,0x0408,IntPtr.Zero,IntPtr.Zero).ToInt32();
           int native=high>low?(pos-low)*100/(high-low):0,rendered=native;
           if(fallback){if(!IsWindowVisible(progress)||art!=IntPtr.Zero)throw new Exception("Artwork failure did not retain the native progress bar.");fallbackSamples++;}
           else{
             uint helper;GetWindowThreadProcessId(art,out helper);
             if(helper==0||helper==(uint)process.Id)throw new Exception("Artwork must be owned by its separate drawing process.");
             helpers.Add((int)helper);
             // PrintWindow performs cross-process rendering; HBITMAP handles are process-private.
             using(var image=Capture(art))if(!canonical.TryGetValue(Hash(image),out rendered))throw new Exception("Rendered ring is not a valid generated frame.");
           }
           var text=new StringBuilder(1024);ReadControlText(status,0x000D,new IntPtr(text.Capacity),text);
           positions.Add(native);bool changed=frames.Add(rendered);statuses.Add(text.ToString());samples++;
           lines.Add(native+","+rendered+","+text.ToString().Replace(","," "));
           File.WriteAllLines(Path.Combine(args[2],"native-progress.csv"),lines);
           if(native<0||native>100||(!fallback&&Math.Abs(native-rendered)>15))throw new Exception("Rendered ring "+rendered+" does not follow native NSIS progress "+native+" (range "+low+".."+high+", position "+pos+").");
           if(changed&&snapshots<4&&rendered>=snapshots*20) {
             using(var screenshot=Capture(window)) {
               int red=0;for(int y=0;y<screenshot.Height;y++)for(int x=0;x<screenshot.Width;x++){var color=screenshot.GetPixel(x,y);if(color.R>150&&color.G<120&&color.B<160)red++;}
               if(!fallback&&red<500)throw new Exception("Window screenshot does not show the red X/ring.");
               screenshot.Save(Path.Combine(args[2],(fallback?"fallback-":"theme-")+rendered.ToString("D3")+".png"),ImageFormat.Png);snapshots++;
             }
           }
           if(terminate&&!helperKilled&&native>=40&&frames.Count>=3){
             uint ownedHelper;GetWindowThreadProcessId(art,out ownedHelper);
             if(ownedHelper==0||ownedHelper==(uint)process.Id)throw new Exception("Refusing to terminate any process except the artwork owner.");
             using(var helper=Process.GetProcessById((int)ownedHelper)){
               if(Path.GetFileName(helper.MainModule.FileName)!="redx-installer-theme.exe")throw new Exception("Unexpected artwork process identity.");
               helper.Kill();if(!helper.WaitForExit(2000))throw new Exception("Artwork test process did not terminate.");
             }
             helperKilled=true;fallback=true;
           }
         }
       }
       Thread.Sleep(80);
     }
     if(!process.HasExited)throw new Exception("Theme fixture timed out.");
     foreach(int helperId in helpers){try{using(var helper=Process.GetProcessById(helperId))if(!helper.WaitForExit(2000))throw new Exception("Drawing helper outlived its installer window.");}catch(ArgumentException){}}
     File.WriteAllLines(Path.Combine(args[2],"native-progress.csv"),lines);
     bool extractionStatus=false;foreach(var statusText in statuses)if(statusText.Contains("fixture-"))extractionStatus=true;
     if(process.ExitCode!=0||samples<5||frames.Count<3||positions.Count<3||statuses.Count<2||snapshots<2||!extractionStatus)throw new Exception("Insufficient evidence: exit="+process.ExitCode+", samples="+samples+", frames="+frames.Count+", positions="+positions.Count+", statuses="+statuses.Count+", PNGs="+snapshots+", extraction="+extractionStatus+".");
     if(requireArt&&helpers.Count!=1)throw new Exception("Expected exactly one isolated drawing helper.");
     if(terminate&&(!helperKilled||fallbackSamples<3))throw new Exception("Insufficient progress evidence after forced artwork termination.");
     File.WriteAllText(Path.Combine(args[2],"theme-result.json"),"{\"passed\":true,\"fixtureOnly\":true,\"nativeFallback\":"+fallback.ToString().ToLowerInvariant()+",\"forcedDrawingTermination\":"+helperKilled.ToString().ToLowerInvariant()+",\"fallbackSamples\":"+fallbackSamples+",\"isolatedDrawingProcesses\":"+helpers.Count+",\"drawingProcessExited\":true,\"samples\":"+samples+",\"distinctNativePositions\":"+positions.Count+",\"distinctRenderedFrames\":"+frames.Count+",\"statusChanges\":"+statuses.Count+",\"screenshots\":"+snapshots+"}");
     Console.WriteLine("Native installer theme captures and real progress checks passed.");return 0;
   } catch(Exception error) {Console.Error.WriteLine(error.Message);File.WriteAllText(Path.Combine(args[2],"failure.txt"),error.ToString());return 1;}
   finally {
     if(process!=null&&!process.HasExited){process.Kill();process.WaitForExit();}
     // On a failed assertion, give recorded artwork owners the same bounded
     // parent-exit grace before PowerShell cleans the checked fixture target.
     foreach(int id in helpers){try{using(var helper=Process.GetProcessById(id))helper.WaitForExit(2000);}catch(ArgumentException){}}
   }
 }
}
