using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class SaCodeDeliverySecurity {
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode)]
    private static extern uint GetNamedSecurityInfoW(string name, int type, uint info, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")]
    private static extern bool GetAce(IntPtr acl, uint index, out IntPtr ace);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode)]
    private static extern bool ConvertSidToStringSidW(IntPtr sid, out IntPtr text);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr pointer);

    // Query only the mandatory label; never modifies an ACL or process token.
    public static string ReadLabel(string path) {
        IntPtr owner, group, dacl, sacl, descriptor;
        uint error=GetNamedSecurityInfoW(path, 1, 0x10, out owner, out group, out dacl, out sacl, out descriptor);
        if(error!=0) throw new Win32Exception((int)error);
        try {
            if(sacl==IntPtr.Zero) return "implicit-medium";
            int count=Marshal.ReadInt16(sacl, 4);
            for(uint i=0;i<count;i++) {
                IntPtr ace;
                if(!GetAce(sacl,i,out ace)) throw new Win32Exception(Marshal.GetLastWin32Error());
                if(Marshal.ReadByte(ace)!=0x11) continue;
                IntPtr text;
                if(!ConvertSidToStringSidW(IntPtr.Add(ace,8),out text)) throw new Win32Exception(Marshal.GetLastWin32Error());
                try { return Marshal.PtrToStringUni(text); } finally { LocalFree(text); }
            }
            return "implicit-medium";
        } finally { LocalFree(descriptor); }
    }
}
