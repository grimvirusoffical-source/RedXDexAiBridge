using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

public static class BridgeInput {
    [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int dx,dy; public uint data,flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KeyboardInput { public ushort key,scan; public uint flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MouseInput mouse; [FieldOffset(0)] public KeyboardInput keyboard; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public InputUnion value; }
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll", SetLastError=true)] static extern bool SetPhysicalCursorPos(int x,int y);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    static JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength=131072 };
    static Dictionary<string,object> data;
    static string Str(string key,string fallback="") { return data.ContainsKey(key)?Convert.ToString(data[key]):fallback; }
    static int Num(string key,int fallback=0) { return data.ContainsKey(key)?Convert.ToInt32(data[key]):fallback; }
    static void Fail(string message) { throw new InvalidOperationException(message); }
    static void Send(Input value) { if(SendInput(1,new Input[]{value},Marshal.SizeOf(typeof(Input)))!=1) Fail("Windows rejected input. The active desktop may be locked, or the destination may have higher privileges. No privilege escalation was attempted."); }
    static void Key(ushort key,bool down) { Send(new Input {type=1,value=new InputUnion {keyboard=new KeyboardInput {key=key,flags=down?0u:2u}}}); }
    static void Mouse(uint flags,int wheel=0) { Send(new Input {type=0,value=new InputUnion {mouse=new MouseInput {flags=flags,data=unchecked((uint)wheel)}}}); }
    static void Move(int x,int y) { if(Math.Abs((long)x)>50000||Math.Abs((long)y)>50000) Fail("Invalid coordinates");if(!SetPhysicalCursorPos(x,y)) Fail("Windows refused pointer movement"); }
    static readonly Dictionary<string,ushort> keys = new Dictionary<string,ushort> {
      {"enter",13},{"tab",9},{"space",32},{"backspace",8},{"escape",27},{"left",37},{"up",38},{"right",39},{"down",40},{"delete",46},{"home",36},{"end",35},{"pageup",33},{"pagedown",34}
    };
    public static int Main() {
      try {
        Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        string raw=Console.In.ReadToEnd();if(raw.Length>65536)Fail("Input request too large");
        data=json.Deserialize<Dictionary<string,object>>(raw);if(data==null)Fail("Invalid request");
        string action=Str("action");
        if(action=="status") { Console.WriteLine(json.Serialize(new {platform="win32",accessibility=GetForegroundWindow()!=IntPtr.Zero,inputSupported=GetForegroundWindow()!=IntPtr.Zero,inputAvailable=GetForegroundWindow()!=IntPtr.Zero,coordinateSystem="physical-pixels",screenRecording=(bool?)null,message="Input uses the current Windows interactive desktop; secure and elevated desktops remain protected."}));return 0; }
        if(action=="move") Move(Num("x"),Num("y"));
        else if(action=="click") {
          int count=Num("count",1);if(count<1||count>2)Fail("Invalid click count");
          string button=Str("button","left");if(button!="left"&&button!="right")Fail("Invalid mouse button");
          Move(Num("x"),Num("y"));for(int i=0;i<count;i++){Mouse(button=="right"?8u:2u);Mouse(button=="right"?16u:4u);System.Threading.Thread.Sleep(70);}
        } else if(action=="drag") {
          int x=Num("x"),y=Num("y"),tx=Num("toX"),ty=Num("toY");Move(x,y);Mouse(2);
          try {for(int n=1;n<=20;n++){Move(x+(tx-x)*n/20,y+(ty-y)*n/20);System.Threading.Thread.Sleep(12);}}finally{Mouse(4);}
        } else if(action=="scroll") {
          int dx=Num("dx"),dy=Num("dy");if(Math.Abs((long)dx)>10000||Math.Abs((long)dy)>10000)Fail("Scroll limit exceeded");
          if(dy!=0)Mouse(0x0800,dy);if(dx!=0)Mouse(0x1000,dx);
        } else if(action=="type") {
          string text=Str("text");if(text.Length>8000)Fail("Text limit exceeded");
          foreach(char c in text)foreach(uint flag in new uint[]{4,6})Send(new Input {type=1,value=new InputUnion {keyboard=new KeyboardInput {scan=c,flags=flag}}});
        } else if(action=="key") {
          string name=Str("key").ToLowerInvariant();ushort code; int functionKey;
          if(name.Length==1&&((name[0]>='a'&&name[0]<='z')||(name[0]>='0'&&name[0]<='9')))code=(ushort)Char.ToUpperInvariant(name[0]);
          else if(name.Length>=2 && name[0]=='f' && Int32.TryParse(name.Substring(1),out functionKey) && functionKey>=1 && functionKey<=12)code=(ushort)(111+functionKey);
          else if(!keys.TryGetValue(name,out code)) {Fail("Unsupported key");return 1;}
          List<ushort> mods=new List<ushort>();
          if(data.ContainsKey("modifiers")&&data["modifiers"]!=null)foreach(object v in (System.Collections.IEnumerable)data["modifiers"]){string m=Convert.ToString(v);if(m=="command")mods.Add(0x5b);else if(m=="control")mods.Add(0x11);else if(m=="option")mods.Add(0x12);else if(m=="shift")mods.Add(0x10);else Fail("Unsupported modifier");}
          try {foreach(ushort m in mods)Key(m,true);Key(code,true);Key(code,false);}finally{mods.Reverse();foreach(ushort m in mods)Key(m,false);}
        } else Fail("Unsupported input action");
        Console.WriteLine(json.Serialize(new {ok=true,action=action}));return 0;
      } catch(Exception e) {Console.Error.WriteLine(e.Message);return 1;}
    }
}
