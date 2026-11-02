; NSIS keeps ownership of installation, cancellation and progress. The artwork
; only displays PBM_GETPOS / PBM_GETRANGE; no clock-based or invented progress.
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
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
Var RedXSourceDC
Var RedXSourceBitmap
Var RedXLastPercent
Var RedXTimer
!endif

!macro RedXExtractTheme
!ifndef BUILD_UNINSTALLER
  IfSilent redx_theme_extract_done
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\redx-theme"
  File /oname=progress.bmp "${BUILD_RESOURCES_DIR}\installer-theme\progress-sprite.bmp"
  SetOutPath "$INSTDIR"
redx_theme_extract_done:
!endif
!macroend

!ifndef BUILD_UNINSTALLER
Function RedXThemeShow
  StrCpy $RedXSourceBitmap 0
  StrCpy $RedXSourceDC 0
  StrCpy $RedXTimer 0
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
  ; Keep a normal OS-owned window frame, with its dark caption where supported.
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4) i .r0'
  System::Call 'user32::SetWindowPos(p $HWNDPARENT,p 0,i 0,i 0,i 640,i 430,i 6)'
  System::Call 'user32::SetWindowPos(p $RedXPage,p 0,i 16,i 58,i 608,i 312,i 4)'
  ShowWindow $RedXProgress 0
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
  System::Call 'user32::CreateWindowExW(i 0,w "STATIC",w "",i 0x5000000E,i 204,i 0,i 200,i 232,p $RedXPage,p 0,p 0,p 0) p .r0'
  StrCpy $RedXArt $0
  ${If} $RedXArt == 0
    ShowWindow $RedXProgress 5
    Return
  ${EndIf}
  System::Call 'user32::LoadImageW(p 0,w "$PLUGINSDIR\redx-theme\progress.bmp",i 0,i 0,i 0,i 0x2010) p .r0'
  StrCpy $RedXSourceBitmap $0
  ${If} $RedXSourceBitmap == 0
    ShowWindow $RedXArt 0
    ShowWindow $RedXProgress 5
    Return
  ${EndIf}
  System::Call 'gdi32::CreateCompatibleDC(p 0) p .r0'
  StrCpy $RedXSourceDC $0
  ${If} $RedXSourceDC == 0
    System::Call 'gdi32::DeleteObject(p $RedXSourceBitmap)'
    StrCpy $RedXSourceBitmap 0
    ShowWindow $RedXArt 0
    ShowWindow $RedXProgress 5
    Return
  ${EndIf}
  System::Call 'gdi32::SelectObject(p $RedXSourceDC,p $RedXSourceBitmap) p .r0'
  StrCpy $RedXLastPercent -1
  Call RedXThemeTick
  GetFunctionAddress $RedXTimer RedXThemeTick
  nsDialogs::CreateTimer $RedXTimer 120
FunctionEnd

Function RedXThemeTick
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  ; PBM_GETRANGE(TRUE/FALSE) is the actual NSIS engine's instruction range.
  SendMessage $RedXProgress 0x0407 1 0 $1
  SendMessage $RedXProgress 0x0407 0 0 $2
  SendMessage $RedXProgress 0x0408 0 0 $0
  IntOp $0 $0 - $1
  IntOp $2 $2 - $1
  ${If} $2 > 0
    IntOp $0 $0 * 100
    IntOp $0 $0 / $2
  ${Else}
    StrCpy $0 0
  ${EndIf}
  ${If} $0 < 0
    StrCpy $0 0
  ${EndIf}
  ${If} $0 > 100
    StrCpy $0 100
  ${EndIf}
  ${If} $0 != $RedXLastPercent
    StrCpy $RedXLastPercent $0
    IntOp $1 $0 * 232
    System::Call 'user32::GetDC(p $RedXArt) p .r2'
    System::Call 'gdi32::CreateCompatibleDC(p r2) p .r3'
    System::Call 'gdi32::CreateCompatibleBitmap(p r2,i 200,i 232) p .r4'
    System::Call 'gdi32::SelectObject(p r3,p r4) p .r5'
    System::Call 'gdi32::BitBlt(p r3,i 0,i 0,i 200,i 232,p $RedXSourceDC,i 0,i r1,i 0x00CC0020)'
    System::Call 'gdi32::SelectObject(p r3,p r5)'
    System::Call 'gdi32::DeleteDC(p r3)'
    System::Call 'user32::ReleaseDC(p $RedXArt,p r2)'
    SendMessage $RedXArt 0x0172 0 $4 $5
    ${If} $5 != 0
      System::Call 'gdi32::DeleteObject(p r5)'
    ${EndIf}
  ${EndIf}
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function RedXThemeLeave
  ${If} $RedXSourceBitmap == 0
    Return
  ${EndIf}
  nsDialogs::KillTimer $RedXTimer
  SendMessage $RedXArt 0x0172 0 0 $0
  ${If} $0 != 0
    System::Call 'gdi32::DeleteObject(p r0)'
  ${EndIf}
  System::Call 'gdi32::DeleteDC(p $RedXSourceDC)'
  System::Call 'gdi32::DeleteObject(p $RedXSourceBitmap)'
FunctionEnd
!endif
