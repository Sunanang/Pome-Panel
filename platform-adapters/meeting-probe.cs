// Loaded once by the PowerShell probe; uses only read-only system APIs.
// MF interface layout: Microsoft Windows SDK mfidl.h. No camera is opened.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

namespace PomeMeeting {
public class Signal {
    public bool? active;
    public bool available;
    public string error;
    public static Signal Known(bool value) { return new Signal { active = value, available = true }; }
    public static Signal Unknown(string reason) { return new Signal { error = reason }; }
}
[ComImport, Guid("39DC7F4A-B141-4719-813C-A7F46162A2B8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IProcessActivity {
    void GetProcessId(out uint pid);
    void GetStreamingState([MarshalAs(UnmanagedType.Bool)] out bool streaming);
    void GetStreamingMode(out int mode);
    void GetReportTime(out System.Runtime.InteropServices.ComTypes.FILETIME time);
}
[ComImport, Guid("3E8C4BE1-A8C2-4528-90DE-2851BDE5FEAD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IActivityReport {
    void GetFriendlyName([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, uint length, out uint written);
    void GetSymbolicLink([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, uint length, out uint written);
    void GetProcessCount(out uint count);
    void GetProcessActivity(uint index, out IProcessActivity activity);
}
[ComImport, Guid("683F7A5E-4A19-43CD-B1A9-DBF4AB3F7777"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IActivitiesReport {
    void GetCount(out uint count);
    void GetActivityReport(uint index, out IActivityReport report);
    void GetActivityReportByDeviceName([MarshalAs(UnmanagedType.LPWStr)] string name, out IActivityReport report);
}
[Guid("DE5072EE-DBE3-46DC-8A87-B6F631194751"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComVisible(true)]
public interface IReportCallback { [PreserveSig] int OnActivitiesReport(IActivitiesReport report); }
[ComImport, Guid("D0CEF145-B3F4-4340-A2E5-7A5080CA05CB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IActivityMonitor { void Start(); void Stop(); }

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class CameraReader : IReportCallback, IDisposable {
    [DllImport("mfplat.dll", ExactSpelling = true)] static extern int MFStartup(uint version, uint flags);
    [DllImport("mfplat.dll", ExactSpelling = true)] static extern int MFShutdown();
    [DllImport("mfsensorgroup.dll", ExactSpelling = true)] static extern int MFCreateSensorActivityMonitor(IReportCallback callback, out IActivityMonitor monitor);
    readonly object gate = new object();
    readonly Dictionary<string, bool?> devices = new Dictionary<string, bool?>();
    readonly int ownPid;
    readonly string ownExecutable;
    IActivityMonitor monitor;
    bool started;
    public CameraReader(int pid, string executable) {
        ownPid = pid; ownExecutable = executable;
        try {
            Marshal.ThrowExceptionForHR(MFStartup(0x20070, 1)); started = true;
            Marshal.ThrowExceptionForHR(MFCreateSensorActivityMonitor(this, out monitor)); monitor.Start();
        } catch { monitor = null; }
    }
    bool IsOurs(uint pid) {
        if (pid == ownPid) return true;
        try { using (Process process = Process.GetProcessById((int)pid)) {
            return String.Equals(process.MainModule.FileName, ownExecutable, StringComparison.OrdinalIgnoreCase);
        } } catch { return false; }
    }
    public int OnActivitiesReport(IActivitiesReport reports) {
        try {
            uint count; reports.GetCount(out count);
            for (uint index = 0; index < count; index++) {
                IActivityReport report = null;
                try {
                    reports.GetActivityReport(index, out report);
                    uint written, processes; StringBuilder name = new StringBuilder(2048);
                    report.GetSymbolicLink(name, 2048, out written); report.GetProcessCount(out processes);
                    bool active = false, uncertain = false;
                    for (uint p = 0; p < processes; p++) {
                        IProcessActivity activity = null;
                        try { uint pid; bool streaming;
                            report.GetProcessActivity(p, out activity); activity.GetProcessId(out pid); activity.GetStreamingState(out streaming);
                            if (streaming && !IsOurs(pid)) active = true;
                        } catch { uncertain = true; }
                        finally { if (activity != null) Marshal.ReleaseComObject(activity); }
                    }
                    lock (gate) devices[name.ToString()] = active ? true : uncertain ? (bool?)null : false;
                } finally { if (report != null) Marshal.ReleaseComObject(report); }
            }
        } catch { lock (gate) { devices.Clear(); } }
        return 0;
    }
    public Signal Read() {
        lock (gate) {
            bool uncertain = devices.Count == 0 || monitor == null;
            foreach (bool? value in devices.Values) { if (value == true) return Signal.Known(true); if (!value.HasValue) uncertain = true; }
            return uncertain ? Signal.Unknown("camera_unavailable") : Signal.Known(false);
        }
    }
    public void Dispose() {
        if (monitor != null) { try { monitor.Stop(); } catch {} Marshal.ReleaseComObject(monitor); monitor = null; }
        if (started) { MFShutdown(); started = false; }
    }
}

public static class SystemReader {
    // Windows exposes no supported Win32 DND getter. Isolate the Shell WNF
    // compatibility query; unknown versions/failures stay unknown, never off.
    [DllImport("ntdll.dll", ExactSpelling = true)] static extern int NtQueryWnfStateData(ref ulong state, IntPtr type,
        IntPtr scope, out uint stamp, out uint data, ref uint length);
    [DllImport("user32.dll", ExactSpelling = true)] static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
    [DllImport("user32.dll", ExactSpelling = true)] static extern int QueryDisplayConfig(uint flags, ref uint paths, IntPtr pathData,
        ref uint modes, IntPtr modeData, IntPtr topology);
    public static Signal Focus() {
        try {
            ulong state = 0x0D83063EA3BF1C75UL; uint stamp, data, length = 4;
            int status = NtQueryWnfStateData(ref state, IntPtr.Zero, IntPtr.Zero, out stamp, out data, ref length);
            if (status == 0 && length == 4 && data <= 2) return Signal.Known(data != 0);
        } catch {}
        return Signal.Unknown("focus_unavailable");
    }
    public static Signal Mirroring() {
        try {
            for (int attempt = 0; attempt < 3; attempt++) {
                uint paths, modes;
                if (GetDisplayConfigBufferSizes(2, out paths, out modes) != 0 || paths > 1024 || modes > 4096) break;
                IntPtr pathData = Marshal.AllocHGlobal((int)Math.Max(paths, 1) * 72);
                IntPtr modeData = Marshal.AllocHGlobal((int)Math.Max(modes, 1) * 64);
                try {
                    int status = QueryDisplayConfig(2, ref paths, pathData, ref modes, modeData, IntPtr.Zero);
                    if (status == 122) continue;
                    if (status != 0) break;
                    HashSet<string> sources = new HashSet<string>();
                    for (int index = 0; index < paths; index++) {
                        int offset = index * 72;
                        string source = Marshal.ReadInt32(pathData, offset) + ":" + Marshal.ReadInt32(pathData, offset + 4) + ":" + Marshal.ReadInt32(pathData, offset + 8);
                        if (!sources.Add(source)) return Signal.Known(true);
                    }
                    return Signal.Known(false);
                } finally { Marshal.FreeHGlobal(pathData); Marshal.FreeHGlobal(modeData); }
            }
        } catch {}
        return Signal.Unknown("display_unavailable");
    }
    static readonly HashSet<string> SharingProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "Zoom", "CptHost", "wemeetapp", "TencentMeeting", "TMeeting", "ms-teams", "Teams", "chrome", "msedge", "firefox", "Webex", "atmgr", "Lark", "Feishu", "Slack"
    };
    static readonly HashSet<string> StopSharing = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "Stop sharing", "Stop screen sharing", "Stop presenting", "停止共享", "停止共享屏幕", "结束共享", "停止分享", "停止分享螢幕", "結束分享",
        "Freigabe beenden", "Bildschirmfreigabe beenden", "Arrêter le partage", "Dejar de compartir", "Parar compartilhamento", "Interromper compartilhamento",
        "共有を停止", "画面共有を停止", "공유 중지", "Остановить демонстрацию", "Прекратить демонстрацию"
    };
    public static Signal Sharing() {
        Signal mirror = Mirroring(); if (mirror.active == true) return mirror;
        bool incomplete = !mirror.available;
        Stopwatch clock = Stopwatch.StartNew();
        try {
            HashSet<int> pids = new HashSet<int>();
            foreach (Process process in Process.GetProcesses()) {
                using (process) { try { if (SharingProcesses.Contains(process.ProcessName)) pids.Add(process.Id); } catch {} }
            }
            AutomationElementCollection windows = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement window in windows) {
                try {
                    if (!pids.Contains(window.Current.ProcessId)) continue;
                    Queue<AutomationElement> queue = new Queue<AutomationElement>(); queue.Enqueue(window);
                    int visited = 0;
                    while (queue.Count > 0 && ++visited <= 650 && clock.ElapsedMilliseconds < 1200) {
                        AutomationElement element = queue.Dequeue();
                        AutomationElement.AutomationElementInformation info = element.Current;
                        if (info.ControlType == ControlType.Button && info.IsEnabled && !info.IsOffscreen && StopSharing.Contains(info.Name.Trim())) return Signal.Known(true);
                        // Browser capture toolbars live outside web documents.
                        if (info.ControlType == ControlType.Document) continue;
                        AutomationElement child = TreeWalker.ControlViewWalker.GetFirstChild(element);
                        int siblings = 0;
                        while (child != null && ++siblings <= 150 && clock.ElapsedMilliseconds < 1200) {
                            queue.Enqueue(child); child = TreeWalker.ControlViewWalker.GetNextSibling(child);
                        }
                        if (child != null) incomplete = true;
                    }
                    if (queue.Count > 0) incomplete = true;
                } catch { incomplete = true; }
                if (clock.ElapsedMilliseconds >= 1200) { incomplete = true; break; }
            }
        } catch { incomplete = true; }
        return incomplete ? Signal.Unknown("sharing_scan_incomplete") : Signal.Known(false);
    }
}
}
