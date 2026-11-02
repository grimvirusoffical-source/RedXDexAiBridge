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
using System.Web.Script.Serialization;
class InstallerThemeCapture {
 delegate bool EnumProc(IntPtr window, IntPtr data);
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; public Point(int x,int y){X=x;Y=y;} }
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr data);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr window,string name);
 [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr window);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder text,int size);
 [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window,int message,IntPtr wParam,IntPtr lParam);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageW")] static extern IntPtr ReadControlText(IntPtr window,int message,IntPtr length,StringBuilder text);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect rect);
 [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window,IntPtr dc,uint flags);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
 [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr window);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint command);
 [DllImport("user32.dll")] static extern int GetSystemMetrics(int metric);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window,int attribute,out Rect rect,int size);
 static int frameRetries;
 static Bitmap CaptureValidArtwork(IntPtr art,Dictionary<string,int> canonical,string evidenceStem,out int frame){
   // A newly shown cross-process HWND may answer PrintWindow before its first
   // paint has settled. Retry only briefly; every accepted image must match
   // a complete genuine sprite frame exactly, with unchanged progress checks.
   for(int attempt=0;attempt<8;attempt++){
     var image=Capture(art);string hash=Hash(image);
     if(canonical.TryGetValue(hash,out frame))return image;
     image.Save(evidenceStem+".unexpected.png",ImageFormat.Png);
     File.AppendAllText(evidenceStem+".retries.jsonl",new JavaScriptSerializer().Serialize(new{attempt=attempt,sha256Rgb=hash,width=image.Width,height=image.Height,utc=DateTime.UtcNow.ToString("O")})+Environment.NewLine);
     image.Dispose();frameRetries++;Thread.Sleep(50);
   }
   throw new Exception("Rendered ring is not a valid generated frame after eight bounded captures; unexpected PNG/hash preserved.");
 }
 static object Bounds(Rect rect){return new{x=rect.Left,y=rect.Top,width=rect.Right-rect.Left,height=rect.Bottom-rect.Top};}
 static bool Contains(Rect outer,Rect inner){return inner.Left>=outer.Left&&inner.Top>=outer.Top&&inner.Right<=outer.Right&&inner.Bottom<=outer.Bottom;}
 static bool Unobscured(IntPtr window,Rect rect){
   // Probe the entire owned fixture at an 8px grid before and after screen copy.
   for(int y=rect.Top+10;y<rect.Bottom-10;y+=8)for(int x=rect.Left+10;x<rect.Right-10;x+=8)if(GetAncestor(WindowFromPoint(new Point(x,y)),2)!=window)return false;
   return true;
 }
 static Bitmap CaptureEvidence(IntPtr window,IntPtr art,IntPtr progress,int owner,int native,bool fallback,Dictionary<string,int> canonical,string stem,out object evidence){
   uint pid;GetWindowThreadProcessId(window,out pid);if(pid!=(uint)owner)throw new Exception("Screenshot target is not the owned fixture.");
   Rect root,canvas=new Rect(),bar;GetWindowRect(window,out root);GetWindowRect(progress,out bar);
   if(!Contains(root,bar))throw new Exception("Native progress is outside its fixture bounds.");
   uint canvasOwner=0;bool above=false;int? actualFrame=null;
   if(!fallback){
     GetWindowRect(art,out canvas);GetWindowThreadProcessId(art,out canvasOwner);
     if(GetAncestor(art,2)!=window||GetParent(art)!=GetParent(progress)||!Contains(root,canvas)||!Contains(canvas,bar))throw new Exception("Artwork/native fallback geometry is invalid.");
     IntPtr sibling=GetWindow(art,2);for(int count=0;sibling!=IntPtr.Zero&&count<256;count++,sibling=GetWindow(sibling,2))if(sibling==progress){above=true;break;}
     if(!above)throw new Exception("Artwork is not above the native fallback bar.");
   }
   Rect screenRoot=root,visibleFrame;try{if(DwmGetWindowAttribute(window,9,out visibleFrame,16)==0&&Contains(root,visibleFrame)&&Contains(visibleFrame,bar)&&(!fallback?Contains(visibleFrame,canvas):true))screenRoot=visibleFrame;}catch(EntryPointNotFoundException){}
   string reason=null,mode=null;bool clear=false;Bitmap result=null;
   if(Environment.UserInteractive){
     var desktop=new Rect{Left=GetSystemMetrics(76),Top=GetSystemMetrics(77)};desktop.Right=desktop.Left+GetSystemMetrics(78);desktop.Bottom=desktop.Top+GetSystemMetrics(79);
     if(!Contains(desktop,screenRoot))reason="fixture outside available desktop";
     else{
       // This changes only the CI-owned fixture's stacking, without activation/input.
       if(!SetWindowPos(window,new IntPtr(-1),0,0,0,0,0x13))reason="owned fixture stacking unavailable";
       else{
         Thread.Sleep(50);clear=Unobscured(window,screenRoot);
         if(!clear)reason="desktop is unavailable or fixture remains obscured";
         else{
           try{
             result=new Bitmap(screenRoot.Right-screenRoot.Left,screenRoot.Bottom-screenRoot.Top,PixelFormat.Format32bppArgb);
             using(var graphics=Graphics.FromImage(result))graphics.CopyFromScreen(screenRoot.Left,screenRoot.Top,0,0,result.Size,CopyPixelOperation.SourceCopy);
             MakeOpaque(result);
             if(!Unobscured(window,screenRoot)){result.Dispose();result=null;reason="fixture obscured during desktop copy";clear=false;}
             else{
               bool black=true;for(int y=0;y<result.Height&&black;y+=4)for(int x=0;x<result.Width;x+=4){var color=result.GetPixel(x,y);if(color.R+color.G+color.B>12){black=false;break;}}
               if(black){result.Dispose();result=null;reason="headless desktop returned black pixels";}
               else if(!fallback){using(var child=result.Clone(new Rectangle(canvas.Left-screenRoot.Left,canvas.Top-screenRoot.Top,200,232),PixelFormat.Format32bppArgb)){int frame;if(!canonical.TryGetValue(Hash(child),out frame))throw new InvalidOperationException("Unobscured desktop does not display a valid artwork frame.");if(Math.Abs(frame-native)>15)throw new InvalidOperationException("Desktop artwork does not match native progress.");actualFrame=frame;}}
             }
           }catch(System.ComponentModel.Win32Exception error){if(result!=null)result.Dispose();result=null;reason="desktop copy unavailable: "+error.NativeErrorCode;}
         }
       }
     }
   }else reason="runner has no interactive desktop";
   if(result!=null)mode="desktopWindowRect";
   else{
     // PrintWindow(parent) does not consistently compose foreign-process child
     // HWNDs. Preserve both actual captures and label the explicit composition.
     result=Capture(window);result.Save(stem+".parent.png",ImageFormat.Png);
     mode="printWindowParent";
     if(!fallback){
       int frame;using(var child=CaptureValidArtwork(art,canonical,stem+".child",out frame)){
         if(Math.Abs(frame-native)>15)throw new Exception("Composite source is not a matching actual artwork frame.");
         actualFrame=frame;child.Save(stem+".child.png",ImageFormat.Png);
         using(var graphics=Graphics.FromImage(result))graphics.DrawImageUnscaled(child,canvas.Left-root.Left,canvas.Top-root.Top);
       }
       mode="printWindowComposite";
     }
   }
   evidence=new{captureMode=mode,desktopUserInteractive=Environment.UserInteractive,desktopUnobscured=clear,desktopFallbackReason=reason,parentProcess=pid,parentBounds=Bounds(root),captureBounds=Bounds(mode=="desktopWindowRect"?screenRoot:root),nativeBounds=Bounds(bar),nativePercent=native,canvasOwner=canvasOwner,canvasBounds=fallback?null:Bounds(canvas),canvasAboveNativeBar=above,canvasFrame=actualFrame,rawParentCapture=mode.StartsWith("printWindow")?Path.GetFileName(stem+".parent.png"):null,rawChildCapture=mode=="printWindowComposite"?Path.GetFileName(stem+".child.png"):null};
   return result;
 }
 static string Hash(Bitmap bitmap) {
   var data=bitmap.LockBits(new Rectangle(0,0,bitmap.Width,bitmap.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
   // GDI window captures do not define alpha; compare only the displayed RGB values.
   try { var raw=new byte[Math.Abs(data.Stride)*data.Height];Marshal.Copy(data.Scan0,raw,0,raw.Length);var rgb=new byte[bitmap.Width*bitmap.Height*3];int next=0;for(int y=0;y<bitmap.Height;y++)for(int x=0;x<bitmap.Width;x++){int offset=y*Math.Abs(data.Stride)+x*4;rgb[next++]=raw[offset];rgb[next++]=raw[offset+1];rgb[next++]=raw[offset+2];}using(var sha=SHA256.Create())return Convert.ToBase64String(sha.ComputeHash(rgb)); }
   finally { bitmap.UnlockBits(data); }
 }
 static void MakeOpaque(Bitmap image){
   var data=image.LockBits(new Rectangle(0,0,image.Width,image.Height),ImageLockMode.ReadWrite,PixelFormat.Format32bppArgb);
   try{var bytes=new byte[Math.Abs(data.Stride)*data.Height];Marshal.Copy(data.Scan0,bytes,0,bytes.Length);for(int y=0;y<data.Height;y++)for(int x=0;x<image.Width;x++)bytes[y*Math.Abs(data.Stride)+x*4+3]=255;Marshal.Copy(bytes,0,data.Scan0,bytes.Length);}finally{image.UnlockBits(data);}
 }
 static Bitmap Capture(IntPtr window) {
   Rect rect;GetWindowRect(window,out rect);var image=new Bitmap(rect.Right-rect.Left,rect.Bottom-rect.Top,PixelFormat.Format32bppArgb);
   bool printed;using(var graphics=Graphics.FromImage(image)){var dc=graphics.GetHdc();try{printed=PrintWindow(window,dc,2);}finally{graphics.ReleaseHdc(dc);}}
   if(!printed){image.Dispose();throw new Exception("Window capture failed.");}
   MakeOpaque(image);
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
           // NativeWindow.AssignHandle may replace a zero child control ID.
           // Resolve the window registered by the drawing owner instead.
           IntPtr registered=GetProp(child,"RedXInstallerThemeWindow");if(registered!=IntPtr.Zero&&IsWindow(registered))art=registered;
           return true;
         },IntPtr.Zero);
         if(progress!=IntPtr.Zero&&(fallback||(art!=IntPtr.Zero&&IsWindowVisible(art)))) {
           int low=SendMessage(progress,0x0407,new IntPtr(1),IntPtr.Zero).ToInt32(),high=SendMessage(progress,0x0407,IntPtr.Zero,IntPtr.Zero).ToInt32(),pos=SendMessage(progress,0x0408,IntPtr.Zero,IntPtr.Zero).ToInt32();
           int native=high>low?(pos-low)*100/(high-low):0,rendered=native;
           if(fallback){if(!IsWindowVisible(progress)||art!=IntPtr.Zero)throw new Exception("Artwork failure did not retain the native progress bar.");fallbackSamples++;}
           else{
             var artClass=new StringBuilder(256);GetClassName(art,artClass,artClass.Capacity);Rect bounds;GetWindowRect(art,out bounds);
             if(!String.Equals(artClass.ToString(),"Static",StringComparison.OrdinalIgnoreCase)||bounds.Right-bounds.Left!=200||bounds.Bottom-bounds.Top!=232)throw new Exception("Registered artwork has an unexpected class or dimensions.");
             uint helper;GetWindowThreadProcessId(art,out helper);
             if(helper==0||helper==(uint)process.Id)throw new Exception("Artwork must be owned by its separate drawing process.");
             helpers.Add((int)helper);
             // PrintWindow performs cross-process rendering; HBITMAP handles are process-private.
             using(var image=CaptureValidArtwork(art,canonical,Path.Combine(args[2],"direct-canvas"),out rendered)){}
           }
           var text=new StringBuilder(1024);ReadControlText(status,0x000D,new IntPtr(text.Capacity),text);
           positions.Add(native);bool changed=frames.Add(rendered);statuses.Add(text.ToString());samples++;
           lines.Add(native+","+rendered+","+text.ToString().Replace(","," "));
           File.WriteAllLines(Path.Combine(args[2],"native-progress.csv"),lines);
           if(native<0||native>100||(!fallback&&Math.Abs(native-rendered)>15))throw new Exception("Rendered ring "+rendered+" does not follow native NSIS progress "+native+" (range "+low+".."+high+", position "+pos+").");
           if(changed&&snapshots<4&&rendered>=snapshots*20) {
             string stem=Path.Combine(args[2],(fallback?"fallback-":"theme-")+rendered.ToString("D3"));object evidence;
             using(var screenshot=CaptureEvidence(window,art,progress,process.Id,native,fallback,canonical,stem,out evidence)) {
               int red=0;for(int y=0;y<screenshot.Height;y++)for(int x=0;x<screenshot.Width;x++){var color=screenshot.GetPixel(x,y);if(color.R>150&&color.G<120&&color.B<160)red++;}
               if(!fallback&&red<500)throw new Exception("Window screenshot does not show the red X/ring.");
               screenshot.Save(stem+".png",ImageFormat.Png);File.WriteAllText(stem+".capture.json",new JavaScriptSerializer().Serialize(evidence));snapshots++;
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
     File.WriteAllText(Path.Combine(args[2],"theme-result.json"),"{\"passed\":true,\"fixtureOnly\":true,\"nativeFallback\":"+fallback.ToString().ToLowerInvariant()+",\"forcedDrawingTermination\":"+helperKilled.ToString().ToLowerInvariant()+",\"fallbackSamples\":"+fallbackSamples+",\"isolatedDrawingProcesses\":"+helpers.Count+",\"drawingProcessExited\":true,\"samples\":"+samples+",\"distinctNativePositions\":"+positions.Count+",\"distinctRenderedFrames\":"+frames.Count+",\"statusChanges\":"+statuses.Count+",\"screenshots\":"+snapshots+",\"strictFrameCaptureRetries\":"+frameRetries+"}");
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
