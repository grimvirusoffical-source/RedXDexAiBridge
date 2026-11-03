// Hosted Windows CI only. Captures the verified foreground fixture, never sends input.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
class GuiSmokeCapture {
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; public Point(int x,int y){X=x;Y=y;} }
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect rect);
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window,out Rect rect);
 [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window,ref Point point);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] static extern int GetSystemMetrics(int metric);
 static bool Contains(Rect outer,Rect inner){return inner.Left>=outer.Left&&inner.Top>=outer.Top&&inner.Right<=outer.Right&&inner.Bottom<=outer.Bottom;}
 static void Verify(IntPtr window,int owner,Rect client){
  uint pid;GetWindowThreadProcessId(window,out pid);
  if(pid!=(uint)owner||!IsWindowVisible(window)||GetAncestor(window,2)!=window||GetForegroundWindow()!=window)throw new Exception("GUI capture target is not the visible foreground fixture owned by this smoke process.");
  Rect local;Point origin=new Point(0,0);
  if(!GetClientRect(window,out local)||!ClientToScreen(window,ref origin)||origin.X!=client.Left||origin.Y!=client.Top||local.Right!=client.Right-client.Left||local.Bottom!=client.Bottom-client.Top)throw new Exception("GUI capture bounds changed.");
  for(int y=client.Top+2;y<client.Bottom-2;y+=16)for(int x=client.Left+2;x<client.Right-2;x+=16)if(GetAncestor(WindowFromPoint(new Point(x,y)),2)!=window)throw new Exception("GUI capture fixture is obscured.");
 }
 public static int Main(string[] args){
  try{
   if(Environment.GetEnvironmentVariable("GITHUB_ACTIONS")!="true"||Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT")!="github-hosted"||Environment.GetEnvironmentVariable("RUNNER_OS")!="Windows")throw new Exception("GUI capture requires hosted Windows CI.");
   long hwnd;int owner;if(args.Length!=3||!Int64.TryParse(args[0],out hwnd)||hwnd<=0||!Int32.TryParse(args[1],out owner)||owner<=0)throw new Exception("Invalid GUI fixture handle or owner.");
   var window=new IntPtr(hwnd);SetThreadDpiAwarenessContext(new IntPtr(-4));
   if(Process.GetProcessById(owner).SessionId!=Process.GetCurrentProcess().SessionId)throw new Exception("GUI fixture is on another session.");
   Rect local,outer;Point origin=new Point(0,0);
   if(!GetClientRect(window,out local)||!ClientToScreen(window,ref origin)||!GetWindowRect(window,out outer))throw new Exception("Cannot read GUI fixture bounds.");
   int width=local.Right,height=local.Bottom;
   var client=new Rect{Left=origin.X,Top=origin.Y,Right=origin.X+width,Bottom=origin.Y+height};
   var desktop=new Rect{Left=GetSystemMetrics(76),Top=GetSystemMetrics(77)};desktop.Right=desktop.Left+GetSystemMetrics(78);desktop.Bottom=desktop.Top+GetSystemMetrics(79);
   if(width<200||height<150||width>4096||height>4096||!Contains(desktop,client)||!Contains(outer,client))throw new Exception("GUI fixture is outside the capturable desktop.");
   Verify(window,owner,client);
   using(var image=new Bitmap(width,height,PixelFormat.Format24bppRgb)){
    using(var graphics=Graphics.FromImage(image))graphics.CopyFromScreen(client.Left,client.Top,0,0,image.Size,CopyPixelOperation.SourceCopy);
    Verify(window,owner,client);
    var colors=new HashSet<int>();int low=255,high=0;
    for(int y=0;y<height;y+=4)for(int x=0;x<width;x+=4){var c=image.GetPixel(x,y);colors.Add(c.ToArgb());int light=(c.R+c.G+c.B)/3;low=Math.Min(low,light);high=Math.Max(high,light);}
    if(colors.Count<12||high-low<30)throw new Exception("GUI capture contains no rendered page detail.");
    string file=Path.GetFullPath(args[2]);Directory.CreateDirectory(Path.GetDirectoryName(file));image.Save(file,ImageFormat.Png);
    string hash;using(var sha=SHA256.Create())hash=BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(file))).Replace("-","").ToLowerInvariant();
    var result=new{schema=1,captureMode="desktopOwnedClientRect",ownerPid=owner,windowHandle=hwnd.ToString(),foreground=true,unobscured=true,coordinateSystem="physical-pixels",bounds=new{x=client.Left,y=client.Top,width=width,height=height},windowBounds=new{x=outer.Left,y=outer.Top,width=outer.Right-outer.Left,height=outer.Bottom-outer.Top},distinctSampleColors=colors.Count,minBrightness=low,maxBrightness=high,sha256=hash};
    File.WriteAllText(Path.ChangeExtension(file,".capture.json"),new JavaScriptSerializer().Serialize(result));
   }
   return 0;
  }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
 }
}
