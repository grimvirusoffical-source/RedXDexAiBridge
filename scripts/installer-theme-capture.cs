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
 const string ArtworkProperty="RedXInstallerThemeWindow",OwnerProperty="RedXInstallerThemeOwnerPID";
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
 sealed class CaptureLifetimeException : Exception { public CaptureLifetimeException(string reason):base(reason){} }
 sealed class CaptureTarget {
   public readonly IntPtr Window,Parent;public readonly uint Owner;public readonly string ClassName;public readonly Rect Bounds;
   public CaptureTarget(IntPtr window){
     Window=window;if(window==IntPtr.Zero||!IsWindow(window))throw new CaptureLifetimeException("capture target destroyed");
     Owner=WindowOwner(window);Parent=GetParent(window);var name=new StringBuilder(256);GetClassName(window,name,name.Capacity);ClassName=name.ToString();
     Rect bounds;if(Owner==0||ClassName.Length==0||!GetWindowRect(window,out bounds)||bounds.Right<=bounds.Left||bounds.Bottom<=bounds.Top)throw new CaptureLifetimeException("capture target lost identity or positive bounds");
     Bounds=bounds;Verify();
   }
   public void Verify(){
     Rect bounds;var name=new StringBuilder(256);GetClassName(Window,name,name.Capacity);
     if(!IsWindow(Window)||WindowOwner(Window)!=Owner||GetParent(Window)!=Parent||name.ToString()!=ClassName)throw new CaptureLifetimeException("capture target destroyed or identity changed");
     if(!GetWindowRect(Window,out bounds)||bounds.Right<=bounds.Left||bounds.Bottom<=bounds.Top)throw new CaptureLifetimeException("capture target lost positive bounds");
     if(bounds.Left!=Bounds.Left||bounds.Top!=Bounds.Top||bounds.Right!=Bounds.Right||bounds.Bottom!=Bounds.Bottom)throw new CaptureLifetimeException("capture target bounds changed");
   }
 }
 static void RequireArtworkBinding(IntPtr art,IntPtr fixture,int owner){
   IntPtr bound;uint drawingOwner;IntPtr page=GetParent(art);
   if(!BoundArtwork(page,owner,out bound,out drawingOwner)||bound!=art||GetAncestor(art,2)!=fixture)throw new CaptureLifetimeException("artwork binding or fixture ancestry changed");
 }
 static string ConfirmLifetimeEnd(Process process,IntPtr page,IntPtr status,int maxNative){
   if(maxNative<95)return null;
   string reason=InactivePage(process,page,status);
   if(reason=="fixture exited"||reason=="installer page unavailable"||reason=="installer page hidden"||reason=="installer page completed")return reason;
   return null;
 }
 static int frameRetries,desktopFrames;
 static uint WindowOwner(IntPtr window){uint owner;GetWindowThreadProcessId(window,out owner);return owner;}
 static string ControlText(IntPtr window,int owner){var text=new StringBuilder(1024);if(window!=IntPtr.Zero&&IsWindow(window)&&WindowOwner(window)==(uint)owner)ReadControlText(window,0x000D,new IntPtr(text.Capacity),text);return text.ToString();}
 static string InactivePage(Process process,IntPtr page,IntPtr status){
   if(process.HasExited)return "fixture exited";
   if(page==IntPtr.Zero||!IsWindow(page))return "installer page unavailable";
   if(WindowOwner(page)!=(uint)process.Id)return "installer page no longer owned";
   if(!IsWindowVisible(page))return "installer page hidden";
   if(String.Equals(ControlText(status,process.Id).Trim(),"Completed",StringComparison.OrdinalIgnoreCase))return "installer page completed";
   return null;
 }
 static bool BoundArtwork(IntPtr page,int installer,out IntPtr art,out uint owner){
   art=IntPtr.Zero;owner=0;if(page==IntPtr.Zero||!IsWindow(page)||WindowOwner(page)!=(uint)installer)return false;
   IntPtr registered=GetProp(page,ArtworkProperty);long pid=GetProp(page,OwnerProperty).ToInt64();
   if(registered==IntPtr.Zero||pid<=0||pid>Int32.MaxValue||pid==installer||!IsWindow(registered)||GetParent(registered)!=page||WindowOwner(registered)!=(uint)pid)return false;
   art=registered;owner=(uint)pid;return true;
 }
 static object ControlState(IntPtr window){
   var name=new StringBuilder(256);if(window!=IntPtr.Zero)GetClassName(window,name,name.Capacity);
   return new{handle="0x"+window.ToInt64().ToString("x"),exists=IsWindow(window),visible=IsWindowVisible(window),owner=WindowOwner(window),parent="0x"+GetParent(window).ToInt64().ToString("x"),className=name.ToString()};
 }
 static void RecordLifecycle(string directory,string reason,Process process,IntPtr window,IntPtr page,IntPtr progress,IntPtr status,IntPtr art,bool fallback,bool killed,string lastSample){
   try{
     bool exited=process==null||process.HasExited;IntPtr raw=GetProp(page,ArtworkProperty),rawOwner=GetProp(page,OwnerProperty);uint boundOwner;IntPtr bound;
     bool registered=process!=null&&BoundArtwork(page,process.Id,out bound,out boundOwner);
     var state=new{utc=DateTime.UtcNow.ToString("O"),reason=reason,fixtureProcess=process==null?0:process.Id,fixtureExited=exited,fixtureExitCode=exited&&process!=null?(int?)process.ExitCode:null,fallback=fallback,forcedDrawingTermination=killed,window=ControlState(window),page=ControlState(page),progress=ControlState(progress),status=ControlState(status),statusText=process==null?"":ControlText(status,process.Id),artwork=ControlState(art),registeredArtwork=ControlState(raw),registeredHelperPID=rawOwner.ToInt64(),boundArtwork=registered,lastGoodSample=lastSample};
     File.AppendAllText(Path.Combine(directory,"control-lifecycle.jsonl"),new JavaScriptSerializer().Serialize(state)+Environment.NewLine);
   }catch(Exception error){Console.Error.WriteLine("Could not record control predicates: "+error.Message);}
 }
 static Bitmap CaptureDesktopArtwork(IntPtr art,IntPtr fixture,int owner){
   RequireArtworkBinding(art,fixture,owner);var target=new CaptureTarget(art);
   if(!Environment.UserInteractive||!IsWindowVisible(art)||GetAncestor(art,2)!=fixture)return null;
   uint fixtureOwner;GetWindowThreadProcessId(fixture,out fixtureOwner);if(fixtureOwner!=(uint)owner)return null;
   Rect rect=target.Bounds;var desktop=new Rect{Left=GetSystemMetrics(76),Top=GetSystemMetrics(77)};desktop.Right=desktop.Left+GetSystemMetrics(78);desktop.Bottom=desktop.Top+GetSystemMetrics(79);
   if(rect.Right-rect.Left!=200||rect.Bottom-rect.Top!=232||!Contains(desktop,rect))return null;
   if(!Unobscured(fixture,rect)){if(!SetWindowPos(fixture,new IntPtr(-1),0,0,0,0,0x13))return null;Thread.Sleep(50);if(!Unobscured(fixture,rect))return null;}
   var image=new Bitmap(200,232,PixelFormat.Format32bppArgb);
   try{using(var graphics=Graphics.FromImage(image))graphics.CopyFromScreen(rect.Left,rect.Top,0,0,image.Size,CopyPixelOperation.SourceCopy);MakeOpaque(image);target.Verify();RequireArtworkBinding(art,fixture,owner);if(!Unobscured(fixture,rect)){image.Dispose();return null;}return image;}
   catch(System.ComponentModel.Win32Exception){image.Dispose();return null;}
   catch{image.Dispose();throw;}
 }
 static Bitmap CaptureValidArtwork(IntPtr art,IntPtr fixture,int owner,Dictionary<string,int> canonical,string evidenceStem,out int frame){
   // A newly shown cross-process HWND may answer PrintWindow before its first
   // paint has settled. Retry only briefly; every accepted image must match
   // a complete genuine sprite frame exactly, with unchanged progress checks.
   bool unverifiedFrame=false;
   try{for(int attempt=0;attempt<8;attempt++){
     RequireArtworkBinding(art,fixture,owner);var image=Capture(art);string hash=Hash(image);
     if(canonical.TryGetValue(hash,out frame))return image;
     unverifiedFrame=true;image.Save(evidenceStem+".unexpected.png",ImageFormat.Png);
     File.AppendAllText(evidenceStem+".retries.jsonl",new JavaScriptSerializer().Serialize(new{attempt=attempt,sha256Rgb=hash,width=image.Width,height=image.Height,utc=DateTime.UtcNow.ToString("O")})+Environment.NewLine);
     image.Dispose();frameRetries++;
     // Some Win32 child windows paint correctly on the desktop but return only
     // background to PrintWindow. Verify actual displayed pixels independently.
     var screen=CaptureDesktopArtwork(art,fixture,owner);
     if(screen!=null){
       screen.Save(evidenceStem+".desktop.png",ImageFormat.Png);
       if(canonical.TryGetValue(Hash(screen),out frame)){
         desktopFrames++;File.AppendAllText(evidenceStem+".retries.jsonl",new JavaScriptSerializer().Serialize(new{captureMode="desktopCanvas",frame=frame,utc=DateTime.UtcNow.ToString("O")})+Environment.NewLine);return screen;
       }
       screen.Dispose();
     }
     Thread.Sleep(50);
   }
   }catch(CaptureLifetimeException error){if(unverifiedFrame)throw new InvalidOperationException("Artwork lifetime changed after an unverified frame; unexpected PNG/hash preserved.",error);throw;}
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
   var rootTarget=new CaptureTarget(window);var barTarget=new CaptureTarget(progress);CaptureTarget canvasTarget=null;
   uint pid=rootTarget.Owner;if(pid!=(uint)owner||barTarget.Owner!=(uint)owner)throw new CaptureLifetimeException("fixture or native bar ownership changed");
   Rect root=rootTarget.Bounds,canvas=new Rect(),bar=barTarget.Bounds;
   if(!Contains(root,bar))throw new Exception("Native progress is outside its fixture bounds.");
   uint canvasOwner=0;bool above=false;int? actualFrame=null;
   if(!fallback){
     RequireArtworkBinding(art,window,owner);canvasTarget=new CaptureTarget(art);canvas=canvasTarget.Bounds;canvasOwner=canvasTarget.Owner;
     if(GetAncestor(art,2)!=window||GetParent(art)!=GetParent(progress)||!Contains(root,canvas)||!Contains(canvas,bar))throw new Exception("Artwork/native fallback geometry is invalid.");
     IntPtr sibling=GetWindow(art,2);for(int count=0;sibling!=IntPtr.Zero&&count<256;count++,sibling=GetWindow(sibling,2))if(sibling==progress){above=true;break;}
     if(!above)throw new Exception("Artwork is not above the native fallback bar.");
   }
   Rect screenRoot=root,visibleFrame;try{if(DwmGetWindowAttribute(window,9,out visibleFrame,16)==0&&Contains(root,visibleFrame)&&Contains(visibleFrame,bar)&&(!fallback?Contains(visibleFrame,canvas):true))screenRoot=visibleFrame;}catch(EntryPointNotFoundException){}
   string reason=null,mode=null,childMode=null;bool clear=false;Bitmap result=null;
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
   if(result!=null){mode="desktopWindowRect";if(!fallback)childMode="desktopWindowRectCrop";}
   else{
     // PrintWindow(parent) does not consistently compose foreign-process child
     // HWNDs. Preserve both actual captures and label the explicit composition.
     result=Capture(window);result.Save(stem+".parent.png",ImageFormat.Png);
     mode="printWindowParent";
     if(!fallback){
       int beforeDesktop=desktopFrames,frame;using(var child=CaptureValidArtwork(art,window,owner,canonical,stem+".child",out frame)){
         if(Math.Abs(frame-native)>15)throw new Exception("Composite source is not a matching actual artwork frame.");
         actualFrame=frame;child.Save(stem+".child.png",ImageFormat.Png);
         using(var graphics=Graphics.FromImage(result))graphics.DrawImageUnscaled(child,canvas.Left-root.Left,canvas.Top-root.Top);
       }
       childMode=desktopFrames>beforeDesktop?"desktopCanvas":"printWindowChild";
       mode="printWindowComposite";
     }
   }
   rootTarget.Verify();barTarget.Verify();if(canvasTarget!=null){canvasTarget.Verify();RequireArtworkBinding(art,window,owner);}
   evidence=new{captureMode=mode,canvasCaptureMode=childMode,desktopUserInteractive=Environment.UserInteractive,desktopUnobscured=clear,desktopFallbackReason=reason,parentProcess=pid,parentBounds=Bounds(root),captureBounds=Bounds(mode=="desktopWindowRect"?screenRoot:root),nativeBounds=Bounds(bar),nativePercent=native,canvasOwner=canvasOwner,canvasBounds=fallback?null:Bounds(canvas),canvasAboveNativeBar=above,canvasFrame=actualFrame,rawParentCapture=mode.StartsWith("printWindow")?Path.GetFileName(stem+".parent.png"):null,rawChildCapture=mode=="printWindowComposite"?Path.GetFileName(stem+".child.png"):null};
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
   var target=new CaptureTarget(window);Rect rect=target.Bounds;var image=new Bitmap(rect.Right-rect.Left,rect.Bottom-rect.Top,PixelFormat.Format32bppArgb);
   bool printed;using(var graphics=Graphics.FromImage(image)){var dc=graphics.GetHdc();try{printed=PrintWindow(window,dc,2);}finally{graphics.ReleaseHdc(dc);}}
   try{target.Verify();}catch{image.Dispose();throw;}
   if(!printed){image.Dispose();throw new Exception("Window capture failed.");}
   MakeOpaque(image);
   return image;
 }
 static int Main(string[] args) {
   if(Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true"||Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT")!="github-hosted"||(args.Length!=3&&args.Length!=4)) { Console.Error.WriteLine("CI runner only."); return 1; }
   bool fallback=args.Length==4&&args[3]=="fallback";
   bool terminate=args.Length==4&&args[3]=="terminate",requireArt=!fallback,helperKilled=false;
   Process process=null;var helpers=new HashSet<int>();var fallbackPositions=new HashSet<int>();var lines=new List<string>();
   IntPtr observedWindow=IntPtr.Zero,observedPage=IntPtr.Zero,observedProgress=IntPtr.Zero,observedStatus=IntPtr.Zero,observedArt=IntPtr.Zero,lastPage=IntPtr.Zero;
   int maxNative=-1,inactivePageSamples=0;string lastInactive=null;
   try {
     SetProcessDPIAware();
     var canonical=new Dictionary<string,int>();
     using(var sprite=new Bitmap(args[1])) for(int i=0;i<=100;i++)using(var frame=sprite.Clone(new Rectangle(0,i*232,200,232),PixelFormat.Format32bppArgb))canonical[Hash(frame)]=i;
     Directory.CreateDirectory(args[2]);
     var start=new ProcessStartInfo(args[0]) { UseShellExecute=false };
     start.EnvironmentVariables["REDX_INSTALLER_THEME_DIAGNOSTICS"]=Path.Combine(args[2],"drawing-helper.log");
     process=Process.Start(start);
     var positions=new HashSet<int>(); var frames=new HashSet<int>(); var statuses=new HashSet<string>();
     int snapshots=0,samples=0,fallbackSamples=0;var watch=Stopwatch.StartNew();
     while(!process.HasExited&&watch.ElapsedMilliseconds<20000) {
       IntPtr window=IntPtr.Zero;
       EnumWindows(delegate(IntPtr candidate,IntPtr ignored) { uint id; GetWindowThreadProcessId(candidate,out id); if(id==(uint)process.Id&&IsWindowVisible(candidate)){window=candidate;return false;}return true; },IntPtr.Zero);
       if(window!=IntPtr.Zero) {
         IntPtr progress=IntPtr.Zero,art=IntPtr.Zero,status=IntPtr.Zero;
         EnumChildWindows(window,delegate(IntPtr child,IntPtr ignored) {
           int id=GetDlgCtrlID(child); if(id==1004)progress=child; if(id==1006)status=child;
           return true;
         },IntPtr.Zero);
         IntPtr page=progress!=IntPtr.Zero?GetParent(progress):lastPage;uint registeredOwner;
         if(page!=IntPtr.Zero&&IsWindow(page)&&WindowOwner(page)==(uint)process.Id&&GetAncestor(page,2)==window)lastPage=page;
         BoundArtwork(page,process.Id,out art,out registeredOwner);
         observedWindow=window;observedPage=page;observedProgress=progress;observedStatus=status;observedArt=art;
         string inactive=InactivePage(process,page,status);
         if(inactive==null&&(!IsWindowVisible(progress)||(fallback&&art!=IntPtr.Zero))){
           // Native controls can disappear while MUI completes, before its
           // process has exited. Recheck the page after a failing predicate.
           inactive=InactivePage(process,page,status);
           if(inactive==null)throw new Exception("Active installer page lost native fallback: progressVisible="+IsWindowVisible(progress)+", boundArtwork="+(art!=IntPtr.Zero)+".");
         }
         if(inactive!=null){
           inactivePageSamples++;
           if(inactive!=lastInactive)RecordLifecycle(args[2],inactive,process,window,page,progress,status,art,fallback,helperKilled,lines.Count==0?null:lines[lines.Count-1]);
           lastInactive=inactive;
         }else{
           lastInactive=null;
           if(!IsWindow(progress)||WindowOwner(progress)!=(uint)process.Id||GetParent(progress)!=page)throw new Exception("Native progress ownership changed on an active installer page.");
           if(!fallback&&helpers.Count>0&&(art==IntPtr.Zero||!IsWindowVisible(art)))throw new Exception("Bound artwork disappeared from an active installer page.");
         }
         if(inactive==null&&progress!=IntPtr.Zero&&(fallback||(art!=IntPtr.Zero&&IsWindowVisible(art)))) {
           try{
           var progressTarget=new CaptureTarget(progress);if(progressTarget.Owner!=(uint)process.Id||progressTarget.Parent!=page)throw new CaptureLifetimeException("native progress identity changed before sampling");
           int low=SendMessage(progress,0x0407,new IntPtr(1),IntPtr.Zero).ToInt32(),high=SendMessage(progress,0x0407,IntPtr.Zero,IntPtr.Zero).ToInt32(),pos=SendMessage(progress,0x0408,IntPtr.Zero,IntPtr.Zero).ToInt32();
           progressTarget.Verify();
           int native=high>low?(pos-low)*100/(high-low):0,rendered=native;
           if(fallback){fallbackSamples++;fallbackPositions.Add(native);}
           else{
             RequireArtworkBinding(art,window,process.Id);var artTarget=new CaptureTarget(art);Rect bounds=artTarget.Bounds;
             if(!String.Equals(artTarget.ClassName,"Static",StringComparison.OrdinalIgnoreCase)||bounds.Right-bounds.Left!=200||bounds.Bottom-bounds.Top!=232)throw new Exception("Registered artwork has an unexpected class or dimensions.");
             uint helper;GetWindowThreadProcessId(art,out helper);
             if(helper==0||helper==(uint)process.Id||helper!=registeredOwner||GetParent(art)!=page){artTarget.Verify();RequireArtworkBinding(art,window,process.Id);throw new Exception("Artwork must remain bound to its registered drawing process and page.");}
             helpers.Add((int)helper);
             // PrintWindow performs cross-process rendering; HBITMAP handles are process-private.
             using(var image=CaptureValidArtwork(art,window,process.Id,canonical,Path.Combine(args[2],"direct-canvas"),out rendered)){}
           }
           string text=ControlText(status,process.Id);
           positions.Add(native);maxNative=Math.Max(maxNative,native);bool changed=frames.Add(rendered);statuses.Add(text);samples++;
           lines.Add(native+","+rendered+","+text.Replace(","," "));
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
             IntPtr killArt;uint killOwner;
             if(!BoundArtwork(page,process.Id,out killArt,out killOwner)||killArt!=art||ownedHelper!=killOwner||ownedHelper==0||ownedHelper==(uint)process.Id)throw new Exception("Refusing to terminate any process except the bound artwork owner.");
             using(var helper=Process.GetProcessById((int)ownedHelper)){
               if(Path.GetFileName(helper.MainModule.FileName)!="redx-installer-theme.exe")throw new Exception("Unexpected artwork process identity.");
               helper.Kill();if(!helper.WaitForExit(2000))throw new Exception("Artwork test process did not terminate.");
             }
             helperKilled=true;fallback=true;
           }
           }catch(CaptureLifetimeException error){
             string end=ConfirmLifetimeEnd(process,page,status,maxNative);
             if(end==null)throw;
             inactivePageSamples++;lastInactive=end;
             RecordLifecycle(args[2],"classified capture lifetime end: "+error.Message+"; confirmed "+end+"; maxNative="+maxNative,process,window,page,progress,status,art,fallback,helperKilled,lines.Count==0?null:lines[lines.Count-1]);
           }
         }
       }
       Thread.Sleep(80);
     }
     if(!process.HasExited)throw new Exception("Theme fixture timed out.");
     foreach(int helperId in helpers){try{using(var helper=Process.GetProcessById(helperId))if(!helper.WaitForExit(2000))throw new Exception("Drawing helper outlived its installer window.");}catch(ArgumentException){}}
     File.WriteAllLines(Path.Combine(args[2],"native-progress.csv"),lines);
     bool extractionStatus=false;foreach(var statusText in statuses)if(statusText.Contains("fixture-"))extractionStatus=true;
     if(process.ExitCode!=0||samples<5||frames.Count<3||positions.Count<3||maxNative<95||statuses.Count<2||snapshots<2||!extractionStatus)throw new Exception("Insufficient evidence: exit="+process.ExitCode+", samples="+samples+", frames="+frames.Count+", positions="+positions.Count+", maxNative="+maxNative+", statuses="+statuses.Count+", PNGs="+snapshots+", extraction="+extractionStatus+".");
     if(requireArt&&helpers.Count!=1)throw new Exception("Expected exactly one isolated drawing helper.");
     if(terminate&&(!helperKilled||fallbackSamples<3||fallbackPositions.Count<3))throw new Exception("Insufficient progress evidence after forced artwork termination.");
     File.WriteAllText(Path.Combine(args[2],"theme-result.json"),"{\"passed\":true,\"fixtureOnly\":true,\"nativeFallback\":"+fallback.ToString().ToLowerInvariant()+",\"forcedDrawingTermination\":"+helperKilled.ToString().ToLowerInvariant()+",\"fallbackSamples\":"+fallbackSamples+",\"fallbackPositions\":"+fallbackPositions.Count+",\"maxNativePosition\":"+maxNative+",\"inactivePageSamples\":"+inactivePageSamples+",\"isolatedDrawingProcesses\":"+helpers.Count+",\"drawingProcessExited\":true,\"samples\":"+samples+",\"distinctNativePositions\":"+positions.Count+",\"distinctRenderedFrames\":"+frames.Count+",\"statusChanges\":"+statuses.Count+",\"screenshots\":"+snapshots+",\"strictFrameCaptureRetries\":"+frameRetries+",\"actualDesktopFrameCaptures\":"+desktopFrames+"}");
     Console.WriteLine("Native installer theme captures and real progress checks passed.");return 0;
   } catch(Exception error) {RecordLifecycle(args[2],"failure: "+error.Message,process,observedWindow,observedPage,observedProgress,observedStatus,observedArt,fallback,helperKilled,lines.Count==0?null:lines[lines.Count-1]);Console.Error.WriteLine(error.Message);File.WriteAllText(Path.Combine(args[2],"failure.txt"),error.ToString());return 1;}
   finally {
     if(process!=null&&!process.HasExited){process.Kill();process.WaitForExit();}
     // On a failed assertion, give recorded artwork owners the same bounded
     // parent-exit grace before PowerShell cleans the checked fixture target.
     foreach(int id in helpers){try{using(var helper=Process.GetProcessById(id))helper.WaitForExit(2000);}catch(ArgumentException){}}
   }
 }
}
