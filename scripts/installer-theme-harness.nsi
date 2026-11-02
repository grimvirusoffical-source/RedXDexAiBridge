; CI-only fixture. The pauses allow inspection of genuine NSIS instruction progress.
Unicode true
Name "Red-XAI installer theme CI fixture"
OutFile "${REDX_THEME_EXE}"
InstallDir "${REDX_THEME_TARGET}"
RequestExecutionLevel user
AutoCloseWindow true
!include "MUI2.nsh"
!include "${BUILD_RESOURCES_DIR}\installer-theme.nsh"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
  !insertmacro RedXExtractTheme
FunctionEnd
Section
  SetDetailsPrint textonly
  SetOutPath "$INSTDIR"
  !include "${REDX_THEME_STEPS}"
SectionEnd
