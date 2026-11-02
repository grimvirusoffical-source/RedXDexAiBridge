; Decoration reads the native NSIS progress control; installation remains owned by NSIS.
; The source-built drawing process never calls back into the NSIS interpreter.
!include "LogicLib.nsh"
!define MUI_BGCOLOR "101014"
!define MUI_TEXTCOLOR "F5F0F2"
!define MUI_INSTFILESPAGE_COLORS "F5F0F2 101014"
!ifndef BUILD_UNINSTALLER
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW RedXThemeShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE RedXThemeLeave
Var RedXPage
Var RedXProgress
Var RedXStatus
Var RedXArt
Var RedXOwnerPID
!endif

!macro RedXExtractTheme
!ifndef BUILD_UNINSTALLER
  IfSilent redx_theme_extract_done
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\redx-theme"
  File /oname=progress.bmp "${BUILD_RESOURCES_DIR}\installer-theme\progress-sprite.bmp"
  File /oname=redx-installer-theme.exe "${BUILD_RESOURCES_DIR}\redx-installer-theme.exe"
  SetOutPath "$INSTDIR"
redx_theme_extract_done:
!endif
!macroend

!ifndef BUILD_UNINSTALLER
Function RedXThemeShow
  FindWindow $RedXPage "#32770" "" $HWNDPARENT
  ${If} $RedXPage == 0
    Return
  ${EndIf}
  GetDlgItem $RedXProgress $RedXPage 1004
  GetDlgItem $RedXStatus $RedXPage 1006
  ${If} $RedXProgress == 0
    Return
  ${EndIf}
  SetCtlColors $HWNDPARENT F5F0F2 101014
  SetCtlColors $RedXPage F5F0F2 101014
  ; Parent background/status repaints must not wipe its foreign-process canvas.
  System::Call 'user32::GetWindowLongW(p $RedXPage,i -16) i .r0'
  IntOp $0 $0 | 0x02000000
  System::Call 'user32::SetWindowLongW(p $RedXPage,i -16,i r0)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4) i .r0'
  System::Call 'user32::SetWindowPos(p $HWNDPARENT,p 0,i 0,i 0,i 640,i 430,i 6)'
  System::Call 'user32::SetWindowPos(p $RedXPage,p 0,i 16,i 58,i 608,i 312,i 4)'
  GetDlgItem $0 $HWNDPARENT 1039
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1256
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1028
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1045
  ShowWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1035
  System::Call 'user32::SetWindowPos(p $0,p 0,i 0,i 56,i 624,i 1,i 4)'
  ; The native bar always remains visible beneath the opaque artwork window.
  ; Even a hard drawing-process crash reveals functional native progress.
  System::Call 'user32::GetWindowLongW(p $RedXProgress,i -16) i .r0'
  IntOp $0 $0 | 0x04000000
  System::Call 'user32::SetWindowLongW(p $RedXProgress,i -16,i r0)'
  System::Call 'user32::SetWindowPos(p $RedXProgress,p 0,i 214,i 108,i 180,i 20,i 4)'
  GetDlgItem $0 $RedXPage 1016
  ShowWindow $0 0
  GetDlgItem $0 $RedXPage 1027
  ShowWindow $0 0
  SetCtlColors $RedXStatus C1B8BE 101014
  System::Call 'user32::SetWindowLongW(p $RedXStatus,i -16,i 0x50000001)'
  System::Call 'user32::SetWindowPos(p $RedXStatus,p 0,i 18,i 246,i 572,i 48,i 4)'
  GetDlgItem $0 $HWNDPARENT 2
  SetCtlColors $0 F5F0F2 34242C
  System::Call 'user32::SetWindowPos(p $0,p 0,i 526,i 360,i 88,i 28,i 4)'
  Exec '"$PLUGINSDIR\redx-theme\redx-installer-theme.exe" $RedXPage $RedXProgress'
FunctionEnd

Function RedXThemeLeave
  Push $0
  Push $1
  Push $2
  Push $3
  ; The page itself must still belong to this installer. HWNDs may be recycled
  ; after a hard helper kill or after the native page has been destroyed.
  System::Call 'kernel32::GetCurrentProcessId() i .r3'
  System::Call 'user32::GetWindowThreadProcessId(p $RedXPage,*i .r1) i .r0'
  ${If} $1 != $3
    Goto redx_theme_leave_done
  ${EndIf}
  System::Call 'user32::GetPropW(p $RedXPage,w "RedXInstallerThemeWindow") p .r0'
  StrCpy $RedXArt $0
  System::Call 'user32::GetPropW(p $RedXPage,w "RedXInstallerThemeOwnerPID") p .r0'
  StrCpy $RedXOwnerPID $0
  ${If} $RedXArt != 0
  ${AndIf} $RedXOwnerPID != 0
    System::Call 'user32::GetParent(p $RedXArt) p .r0'
    System::Call 'user32::GetWindowThreadProcessId(p $RedXArt,*i .r1) i .r2'
    ${If} $0 == $RedXPage
    ${AndIf} $1 == $RedXOwnerPID
    ${AndIf} $1 != $3
      ; Close only the child still bound to the registered helper process.
      System::Call 'user32::SendMessageTimeoutW(p $RedXArt,i 0x0010,p 0,p 0,i 2,i 1000,*p .r0)'
    ${EndIf}
  ${EndIf}
  ; Remove only this same registration pair, including stale hard-kill values.
  ; A graceful helper may already have removed its own pair while closing.
  System::Call 'user32::GetPropW(p $RedXPage,w "RedXInstallerThemeWindow") p .r0'
  System::Call 'user32::GetPropW(p $RedXPage,w "RedXInstallerThemeOwnerPID") p .r1'
  ${If} $0 == $RedXArt
  ${AndIf} $1 == $RedXOwnerPID
    System::Call 'user32::RemovePropW(p $RedXPage,w "RedXInstallerThemeWindow") p .r0'
    System::Call 'user32::GetPropW(p $RedXPage,w "RedXInstallerThemeWindow") p .r0'
    System::Call 'user32::GetPropW(p $RedXPage,w "RedXInstallerThemeOwnerPID") p .r1'
    ${If} $0 == 0
    ${AndIf} $1 == $RedXOwnerPID
      System::Call 'user32::RemovePropW(p $RedXPage,w "RedXInstallerThemeOwnerPID") p .r0'
    ${EndIf}
  ${EndIf}
redx_theme_leave_done:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function .onGUIEnd
  Call RedXThemeLeave
FunctionEnd
!endif
