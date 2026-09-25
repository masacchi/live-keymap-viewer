# 注意: このファイルはBOM付きUTF-8で保存すること(Windows PowerShell 5.1はBOMが無いとShift_JISとして読み、日本語が化けて壊れる)。
# WindowsのHID APIで、Vialのインターフェースに直接問い合わせる(アプリを通さない)。
#
#   npm run diag:hid                 # 既定はVID E118(Cornix)
#   npm run diag:hid -- 3434         # 別のVID
#
# VIDを含むHIDインターフェースを列挙し、用途(UsagePage / Usage)とレポート長を出す。
# usagePage 0xFF60のものには、Vialの「キーボードIDの問い合わせ」[0xFE, 0x00]を1回だけ送り、
# 応答と往復時間を出す(アプリが接続時に最初に送るのと同じ無害な問い合わせ)。
#
# 「OSからは答えるのにアプリでは駄目」なら、原因はアプリ側にある。docs/BLUETOOTH.md §2.6。
param([string]$VendorId = 'e118')
$ErrorActionPreference = 'Stop'
# WSLの端末に日本語が化けずに出るように
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

public static class HidProbe {
  [StructLayout(LayoutKind.Sequential)] public struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }
  [StructLayout(LayoutKind.Sequential)] public struct HIDD_ATTRIBUTES { public int Size; public ushort VendorID; public ushort ProductID; public ushort VersionNumber; }
  [StructLayout(LayoutKind.Sequential)] public struct HIDP_CAPS {
    public ushort Usage; public ushort UsagePage; public ushort InputReportByteLength; public ushort OutputReportByteLength; public ushort FeatureReportByteLength;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
    public ushort NumberLinkCollectionNodes; public ushort NumberInputButtonCaps; public ushort NumberInputValueCaps; public ushort NumberInputDataIndices;
    public ushort NumberOutputButtonCaps; public ushort NumberOutputValueCaps; public ushort NumberOutputDataIndices;
    public ushort NumberFeatureButtonCaps; public ushort NumberFeatureValueCaps; public ushort NumberFeatureDataIndices; }

  [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
  [DllImport("hid.dll")] static extern bool HidD_GetAttributes(SafeFileHandle h, ref HIDD_ATTRIBUTES a);
  [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr pd);
  [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr pd);
  [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr pd, out HIDP_CAPS caps);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr e, IntPtr h, int flags);
  [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr info, ref Guid g, int idx, ref SP_DEVICE_INTERFACE_DATA d);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA d, IntPtr detail, int size, out int req, IntPtr info);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFile(string n, uint a, uint s, IntPtr sec, uint disp, uint f, IntPtr t);

  public static void Run(string vid) {
    Guid g; HidD_GetHidGuid(out g);
    IntPtr set = SetupDiGetClassDevs(ref g, IntPtr.Zero, IntPtr.Zero, 0x12); // PRESENT | DEVICEINTERFACE
    for (int i = 0; ; i++) {
      var d = new SP_DEVICE_INTERFACE_DATA(); d.cbSize = Marshal.SizeOf(d);
      if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref d)) break;
      int req; SetupDiGetDeviceInterfaceDetail(set, ref d, IntPtr.Zero, 0, out req, IntPtr.Zero);
      IntPtr buf = Marshal.AllocHGlobal(req);
      Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
      SetupDiGetDeviceInterfaceDetail(set, ref d, buf, req, out req, IntPtr.Zero);
      string path = Marshal.PtrToStringUni(new IntPtr(buf.ToInt64() + 4));
      Marshal.FreeHGlobal(buf);
      Probe(path, Convert.ToUInt16(vid, 16));
    }
    SetupDiDestroyDeviceInfoList(set);
  }

  static void Probe(string path, ushort vendorId) {
    // VID はパスの文字列ではなく、デバイスの属性で確かめる(関係ない機器に送らないため)
    var a = new HIDD_ATTRIBUTES(); a.Size = Marshal.SizeOf(a);
    using (var peek = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
      if (peek.IsInvalid || !HidD_GetAttributes(peek, ref a) || a.VendorID != vendorId) return;
    }
    Console.WriteLine("path: " + path);
    // 読み書きで開く。駄目なら用途だけ見られるよう 0 アクセスで開く
    var h = CreateFile(path, 0xC0000000, 3, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
    bool rw = !h.IsInvalid;
    int openErr = Marshal.GetLastWin32Error();
    if (!rw) h = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h.IsInvalid) { Console.WriteLine("  open failed: " + openErr); return; }
    IntPtr pd; HIDP_CAPS c = new HIDP_CAPS(); if (HidD_GetPreparsedData(h, out pd)) { HidP_GetCaps(pd, out c); HidD_FreePreparsedData(pd); }
    Console.WriteLine(string.Format("  VID {0:X4} PID {1:X4}  UsagePage {2:X4} Usage {3:X2}  in {4} / out {5} bytes  rw={6}{7}",
      a.VendorID, a.ProductID, c.UsagePage, c.Usage, c.InputReportByteLength, c.OutputReportByteLength, rw, rw ? "" : " (err " + openErr + ")"));
    if (!rw || c.UsagePage != 0xFF60) { h.Dispose(); return; }

    // Vial: キーボード ID の問い合わせ [0xFE, 0x00]。先頭 1 バイトはレポート ID 0
    using (var fs = new FileStream(h, FileAccess.ReadWrite, c.InputReportByteLength, true)) {
      var req = new byte[c.OutputReportByteLength]; req[0] = 0; req[1] = 0xFE; req[2] = 0x00;
      var sw = System.Diagnostics.Stopwatch.StartNew();
      try { fs.Write(req, 0, req.Length); Console.WriteLine("  write ok"); }
      catch (Exception e) { Console.WriteLine("  write failed: " + e.Message); return; }
      var res = new byte[c.InputReportByteLength];
      var t = fs.ReadAsync(res, 0, res.Length);
      if (t.Wait(3000)) {
        Console.WriteLine(string.Format("  reply in {0} ms: {1}", sw.ElapsedMilliseconds, BitConverter.ToString(res, 0, Math.Min(16, res.Length))));
        // Vial なら data[0..3] に vial_protocol が入る。VIA だけの機器は 0xFF(id_unhandled)を返す
        if (res[1] == 0xFF) Console.WriteLine("  -> 0xFF: Vialではない(VIAだけの機器)");
        else Console.WriteLine("  vial_protocol = " + BitConverter.ToUInt32(res, 1));
      } else {
        Console.WriteLine("  NO REPLY within 3000 ms");
      }
    }
  }
}
'@
[HidProbe]::Run($VendorId)
