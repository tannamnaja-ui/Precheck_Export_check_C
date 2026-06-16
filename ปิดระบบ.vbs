Option Explicit
Dim objHTTP, answer

answer = MsgBox("ต้องการปิดระบบ Pre Check Export หรือไม่?", 36, "ยืนยันการปิดระบบ")
If answer <> 6 Then WScript.Quit   ' 6 = Yes

Set objHTTP = CreateObject("MSXML2.XMLHTTP.6.0")
On Error Resume Next
objHTTP.open "POST", "http://localhost:3002/api/shutdown", False
objHTTP.setRequestHeader "Content-Type", "application/json"
objHTTP.setRequestHeader "Connection", "close"
objHTTP.send "{}"
On Error GoTo 0
Set objHTTP = Nothing

MsgBox "ปิดระบบเรียบร้อยแล้ว", 64, "Pre Check Export"
