// Source-built, asInvoker drawing helper. It never executes NSIS code or sends input.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
class InstallerThemeUI {
 const string Property="RedXInstallerThemeWindow";
 static void Trace(string text){
   // Isolated CI diagnostics only; production installs write no extra files.
   if(Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true"||Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT")!="github-hosted")return;
   string file=Environment.GetEnvironmentVariable("REDX_INSTALLER_THEME_DIAGNOSTICS");if(String.IsNullOrEmpty(file))return;
   try{File.AppendAllText(file,DateTime.UtcNow.ToString("O")+" "+text+Environment.NewLine);}catch{}
 }
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder text,int count);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(int extended,string name,string text,int style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
 [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr window,int message,IntPtr wParam,IntPtr lParam,uint flags,uint timeout,out UIntPtr result);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool SetProp(IntPtr window,string name,IntPtr value);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr window,string name);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr window,string name);
 [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] struct PaintStruct { public IntPtr DC;public int Erase;public Rect Paint;public int Restore,Update;[MarshalAs(UnmanagedType.ByValArray,SizeConst=32)]public byte[] Reserved; }
 [DllImport("user32.dll")] static extern IntPtr BeginPaint(IntPtr window,out PaintStruct paint);
 [DllImport("user32.dll")] static extern bool EndPaint(IntPtr window,ref PaintStruct paint);
 [DllImport("user32.dll")] static extern bool InvalidateRect(IntPtr window,IntPtr rect,bool erase);
 [DllImport("user32.dll")] static extern bool UpdateWindow(IntPtr window);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
 sealed class Artwork : NativeWindow {
   readonly ApplicationContext context;
   Bitmap frame;
   public bool Failed {get;private set;}
   public Artwork(IntPtr window,ApplicationContext value){context=value;AssignHandle(window);}
   public void SetFrame(Bitmap value){var previous=frame;frame=value;if(previous!=null)previous.Dispose();InvalidateRect(Handle,IntPtr.Zero,false);UpdateWindow(Handle);}
   public void DisposeFrame(){if(frame!=null){frame.Dispose();frame=null;}}
   void PaintTo(IntPtr dc){
     try{if(frame!=null&&dc!=IntPtr.Zero)using(var graphics=Graphics.FromHdc(dc))graphics.DrawImageUnscaled(frame,0,0);}
     catch(Exception error){Failed=true;Trace("paint failure: "+error.Message);context.ExitThread();}
   }
   protected override void WndProc(ref Message message){
     if(message.Msg==0x0010){DestroyWindow(Handle);context.ExitThread();return;}
     if(message.Msg==0x000F){PaintStruct paint;IntPtr dc=BeginPaint(Handle,out paint);try{PaintTo(dc);}finally{EndPaint(Handle,ref paint);}message.Result=IntPtr.Zero;return;}
     if(message.Msg==0x0317||message.Msg==0x0318){PaintTo(message.WParam);message.Result=IntPtr.Zero;return;}
     // The retained frame paints the entire surface without background flicker.
     if(message.Msg==0x0014){message.Result=new IntPtr(1);return;}
     bool ended=message.Msg==0x0082;base.WndProc(ref message);if(ended)context.ExitThread();
   }
 }
 static int ReadProgress(IntPtr window,int message,int argument){
   UIntPtr value;if(SendMessageTimeout(window,message,new IntPtr(argument),IntPtr.Zero,2,500,out value)==IntPtr.Zero)throw new InvalidOperationException("Native progress window is unavailable.");
   return unchecked((int)value.ToUInt32());
 }
 [STAThread] static int Main(string[] args){
   IntPtr page=IntPtr.Zero,progress=IntPtr.Zero,art=IntPtr.Zero;
   Bitmap sprite=null;Process parent=null;System.Windows.Forms.Timer timer=null;ApplicationContext context=null;Artwork window=null;bool failed=false;
   try{
     Trace("startup; argument count="+args.Length);
     if(args.Length!=2)throw new InvalidOperationException("Expected page and native bar.");
     page=new IntPtr(long.Parse(args[0],CultureInfo.InvariantCulture));progress=new IntPtr(long.Parse(args[1],CultureInfo.InvariantCulture));
     uint owner,progressOwner;GetWindowThreadProcessId(page,out owner);GetWindowThreadProcessId(progress,out progressOwner);
     var className=new StringBuilder(256);GetClassName(progress,className,className.Capacity);
     if(owner==0||owner!=progressOwner||!IsWindow(page)||!IsWindow(progress)||!String.Equals(className.ToString(),"msctls_progress32",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Invalid parent/progress window; class="+className+", same owner="+(owner==progressOwner));
     parent=Process.GetProcessById((int)owner);
     // Resolve a fixed sibling directly. Comparing argument paths would reject
     // equivalent 8.3 and long Windows TEMP paths used by NSIS and the CLR.
     string bitmapPath=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"progress.bmp");
     sprite=new Bitmap(bitmapPath);if(sprite.Width!=200||sprite.Height!=232*101)throw new InvalidOperationException("Invalid progress sprite dimensions.");
     // Match the existing installer window, including its DPI virtualization.
     try{SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(page));}catch(EntryPointNotFoundException){}
     context=new ApplicationContext();
     // Start hidden so a cold CLR/native-message round trip cannot expose an
     // empty STATIC before its first verified progress frame is installed.
     // Leave the native page/header edge outside the bitmap's client surface.
     art=CreateWindowEx(0x08000000,"STATIC","",0x4400000E,204,4,200,232,page,IntPtr.Zero,GetModuleHandle(null),IntPtr.Zero);
     if(art==IntPtr.Zero)throw new InvalidOperationException("Could not create artwork window.");
     window=new Artwork(art,context);if(!SetProp(page,Property,art))throw new InvalidOperationException("Could not register artwork lifetime.");
     Trace("artwork child created");
     int last=-1;var lifetime=Stopwatch.StartNew();
     Action update=delegate{
       uint pageOwner,barOwner;GetWindowThreadProcessId(page,out pageOwner);GetWindowThreadProcessId(progress,out barOwner);
       if(parent.HasExited||!IsWindow(page)||!IsWindow(progress)||pageOwner!=owner||barOwner!=owner||GetProp(page,Property)!=art||lifetime.Elapsed>TimeSpan.FromMinutes(15)){context.ExitThread();return;}
       int low=ReadProgress(progress,0x0407,1),high=ReadProgress(progress,0x0407,0),position=ReadProgress(progress,0x0408,0);
       int percent=high>low?(int)(((long)position-low)*100/(high-low)):0;percent=Math.Max(0,Math.Min(100,percent));
       if(percent==last)return;
       // Keep one managed bitmap alive until the next frame replaces it. Both
       // screen paints and PrintWindow render this same owned image directly.
       window.SetFrame(sprite.Clone(new Rectangle(0,percent*232,200,232),PixelFormat.Format24bppRgb));
       if(window.Failed)throw new InvalidOperationException("Artwork paint failed; retaining native progress fallback.");
       if(last<0&&!SetWindowPos(art,IntPtr.Zero,0,0,0,0,0x53))throw new InvalidOperationException("Could not show initialized artwork above native fallback.");
       if(window.Failed)throw new InvalidOperationException("Artwork first display failed; retaining native progress fallback.");
       last=percent;
       Trace("native frame="+percent);
     };
     timer=new System.Windows.Forms.Timer();timer.Interval=120;timer.Tick+=delegate{try{update();}catch(Exception error){Trace(error.GetType().Name+": "+error.Message);failed=true;context.ExitThread();}};
     update();timer.Start();Application.Run(context);return failed||window.Failed?1:0;
   }catch(Exception error){Trace(error.GetType().Name+": "+error.Message);return 1;}
   finally{
     if(timer!=null)timer.Dispose();if(IsWindow(page)&&GetProp(page,Property)==art)RemoveProp(page,Property);
     if(IsWindow(art))DestroyWindow(art);if(window!=null)window.DisposeFrame();
     if(sprite!=null)sprite.Dispose();if(parent!=null)parent.Dispose();if(window!=null)window.ReleaseHandle();if(context!=null)context.Dispose();
   }
 }
}
