!include "LogicLib.nsh"
!include "${BUILD_RESOURCES_DIR}\installer-theme.nsh"
!macro customInit
  !insertmacro RedXExtractTheme
!macroend
!macro customInstall
  ; Never install optional dependencies without interactive consent.
  ; Skip during silent installs and in-place auto-updates.
  IfSilent optional_done
  ${IfNot} ${isUpdated}
    File /oname=$PLUGINSDIR\optional-tools.ps1 "${BUILD_RESOURCES_DIR}\optional-tools.ps1"

    MessageBox MB_ICONQUESTION|MB_YESNO "Install optional Node.js LTS?$\r$\n$\r$\nNeeded only for Node scripts and building Bridge from source. The installed Bridge, MCP client tools, and public updater work without it.$\r$\n$\r$\nChoose No to skip." IDNO optional_git
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\optional-tools.ps1" node' $0
    IntCmp $0 0 optional_git
    MessageBox MB_ICONEXCLAMATION|MB_OK "Node.js could not be installed automatically. Source builds and Node scripts require a separate installation. The Bridge itself is installed normally."

optional_git:
    MessageBox MB_ICONQUESTION|MB_YESNO "Install optional Git?$\r$\n$\r$\nNeeded for cloning, local commits, branches and repository commands. Bridge updates and desktop controls do not need Git.$\r$\n$\r$\nChoose No to skip." IDNO optional_gh
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\optional-tools.ps1" git' $0
    IntCmp $0 0 optional_gh
    MessageBox MB_ICONEXCLAMATION|MB_OK "Git could not be installed automatically. Repository commands need Git, but Bridge updates and desktop controls still work."

optional_gh:
    MessageBox MB_ICONQUESTION|MB_YESNO "Install optional GitHub CLI?$\r$\n$\r$\nNeeded for GitHub terminal sign-in, pull requests and releases. Public Bridge updates do not require it.$\r$\n$\r$\nChoose No to skip." IDNO optional_done
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\optional-tools.ps1" gh' $0
    IntCmp $0 0 optional_done
    MessageBox MB_ICONEXCLAMATION|MB_OK "GitHub CLI could not be installed automatically. Terminal repository workflows require it; Bridge updates remain available."
  ${EndIf}
optional_done:
  ; electron-builder creates the desktop shortcut before customInstall.
  ; Give the user a choice on fresh interactive installations.
  IfSilent shortcut_done
  ${IfNot} ${isUpdated}
    MessageBox MB_ICONQUESTION|MB_YESNO "Create a Red-XAI Bridge desktop shortcut?$\r$\n$\r$\nChoose No to install the desktop app without a desktop shortcut. The Start menu shortcut will still be available." IDYES taskbar_offer
    Delete "$newDesktopLink"
taskbar_offer:
    ; Windows does not permit installers to silently pin to taskbar.
    MessageBox MB_ICONQUESTION|MB_YESNO "Would you like help pinning Red-XAI Bridge to the Windows taskbar?$\r$\n$\r$\nChoose Yes to show a pinning guide when you first open the desktop app. Windows requires you to confirm the pin yourself." IDNO shortcut_done
    CreateDirectory "$APPDATA\redxdex-ai-bridge"
    FileOpen $R0 "$APPDATA\redxdex-ai-bridge\taskbar-pin-request.txt" w
    IfErrors shortcut_done
    FileWrite $R0 "requested"
    FileClose $R0
  ${EndIf}
shortcut_done:
!macroend
