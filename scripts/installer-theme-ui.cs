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
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder text,int count);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(int extended,string name,string text,int style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
 [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window,int message,IntPtr wParam,IntPtr lParam);
 [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr window,int message,IntPtr wParam,IntPtr lParam,uint flags,uint timeout,out UIntPtr result);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool SetProp(IntPtr window,string name,IntPtr value);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr window,string name);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr window,string name);
 [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr bitmap);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
 sealed class Artwork : NativeWindow {
   readonly ApplicationContext context;
   public Artwork(IntPtr window,ApplicationContext value){context=value;AssignHandle(window);}
   protected override void WndProc(ref Message message){
     if(message.Msg==0x0010){DestroyWindow(Handle);context.ExitThread();return;}
     bool ended=message.Msg==0x0082;base.WndProc(ref message);if(ended)context.ExitThread();
   }
 }
 static int ReadProgress(IntPtr window,int message,int argument){
   UIntPtr value;if(SendMessageTimeout(window,message,new IntPtr(argument),IntPtr.Zero,2,500,out value)==IntPtr.Zero)throw new InvalidOperationException("Native progress window is unavailable.");
   return unchecked((int)value.ToUInt32());
 }
 [STAThread] static int Main(string[] args){
   IntPtr page=IntPtr.Zero,progress=IntPtr.Zero,art=IntPtr.Zero,current=IntPtr.Zero;
   Bitmap sprite=null;Process parent=null;System.Windows.Forms.Timer timer=null;ApplicationContext context=null;Artwork window=null;bool failed=false;
   try{
     if(args.Length!=3)return 1;
     page=new IntPtr(long.Parse(args[0],CultureInfo.InvariantCulture));progress=new IntPtr(long.Parse(args[1],CultureInfo.InvariantCulture));
     uint owner,progressOwner;GetWindowThreadProcessId(page,out owner);GetWindowThreadProcessId(progress,out progressOwner);
     var className=new StringBuilder(256);GetClassName(progress,className,className.Capacity);
     if(owner==0||owner!=progressOwner||!IsWindow(page)||!IsWindow(progress)||!String.Equals(className.ToString(),"msctls_progress32",StringComparison.OrdinalIgnoreCase))return 1;
     parent=Process.GetProcessById((int)owner);
     string bitmapPath=Path.GetFullPath(args[2]);
     if(!String.Equals(Path.GetDirectoryName(bitmapPath).TrimEnd('\\'),AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Artwork must be bundled beside its helper.");
     sprite=new Bitmap(bitmapPath);if(sprite.Width!=200||sprite.Height!=232*101)throw new InvalidOperationException("Invalid progress sprite dimensions.");
     // Match the existing installer window, including its DPI virtualization.
     try{SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(page));}catch(EntryPointNotFoundException){}
     context=new ApplicationContext();
     art=CreateWindowEx(0x08000000,"STATIC","",0x5400000E,204,0,200,232,page,IntPtr.Zero,GetModuleHandle(null),IntPtr.Zero);
     if(art==IntPtr.Zero)throw new InvalidOperationException("Could not create artwork window.");
     window=new Artwork(art,context);if(!SetProp(page,Property,art))throw new InvalidOperationException("Could not register artwork lifetime.");
     if(!SetWindowPos(art,IntPtr.Zero,0,0,0,0,0x13))throw new InvalidOperationException("Could not position artwork above native fallback.");
     int last=-1;var lifetime=Stopwatch.StartNew();
     Action update=delegate{
       uint pageOwner,barOwner;GetWindowThreadProcessId(page,out pageOwner);GetWindowThreadProcessId(progress,out barOwner);
       if(parent.HasExited||!IsWindow(page)||!IsWindow(progress)||pageOwner!=owner||barOwner!=owner||GetProp(page,Property)!=art||lifetime.Elapsed>TimeSpan.FromMinutes(15)){context.ExitThread();return;}
       int low=ReadProgress(progress,0x0407,1),high=ReadProgress(progress,0x0407,0),position=ReadProgress(progress,0x0408,0);
       int percent=high>low?(int)(((long)position-low)*100/(high-low)):0;percent=Math.Max(0,Math.Min(100,percent));
       if(percent==last)return;
       IntPtr next;using(var frame=sprite.Clone(new Rectangle(0,percent*232,200,232),PixelFormat.Format24bppRgb))next=frame.GetHbitmap();
       IntPtr old=SendMessage(art,0x0172,IntPtr.Zero,next);
       if(old!=IntPtr.Zero&&old!=current)DeleteObject(old);if(current!=IntPtr.Zero)DeleteObject(current);current=next;last=percent;
     };
     timer=new System.Windows.Forms.Timer();timer.Interval=120;timer.Tick+=delegate{try{update();}catch{failed=true;context.ExitThread();}};
     update();timer.Start();Application.Run(context);return failed?1:0;
   }catch{return 1;}
   finally{
     if(timer!=null)timer.Dispose();if(IsWindow(page)&&GetProp(page,Property)==art)RemoveProp(page,Property);
     if(IsWindow(art))DestroyWindow(art);if(current!=IntPtr.Zero)DeleteObject(current);
     if(sprite!=null)sprite.Dispose();if(parent!=null)parent.Dispose();if(window!=null)window.ReleaseHandle();if(context!=null)context.Dispose();
   }
 }
}
