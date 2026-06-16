Option Explicit
Dim objShell, objHTTP, scriptDir, isRunning, i

' หาโฟลเดอร์ที่ไฟล์นี้อยู่
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' ตรวจสอบว่า server กำลังรันอยู่แล้วหรือไม่
isRunning = False
Set objHTTP = CreateObject("MSXML2.XMLHTTP.6.0")
On Error Resume Next
objHTTP.open "GET", "http://localhost:3002/", False
objHTTP.setRequestHeader "Connection", "close"
objHTTP.send
If Err.Number = 0 Then
    If objHTTP.status >= 200 And objHTTP.status < 500 Then
        isRunning = True
    End If
End If
On Error GoTo 0
Set objHTTP = Nothing

Set objShell = CreateObject("WScript.Shell")

If Not isRunning Then
    ' เริ่ม server แบบซ่อนหน้าต่าง (window style 0 = hidden)
    objShell.Run "cmd /c node """ & scriptDir & "api_example_nodejs.js""", 0, False

    ' รอให้ server พร้อม (สูงสุด 15 วินาที)
    For i = 1 To 30
        WScript.Sleep 500
        Set objHTTP = CreateObject("MSXML2.XMLHTTP.6.0")
        On Error Resume Next
        objHTTP.open "GET", "http://localhost:3002/", False
        objHTTP.setRequestHeader "Connection", "close"
        objHTTP.send
        If Err.Number = 0 Then
            If objHTTP.status >= 200 And objHTTP.status < 500 Then
                isRunning = True
                i = 30
            End If
        End If
        On Error GoTo 0
        Set objHTTP = Nothing
    Next

    If Not isRunning Then
        MsgBox "ไม่สามารถเริ่มระบบได้" & Chr(13) & "กรุณาตรวจสอบว่าติดตั้ง Node.js แล้ว", 16, "Pre Check Export"
        WScript.Quit
    End If
End If

' เปิด browser
objShell.Run "http://localhost:3002/index_first.html"
Set objShell = Nothing
