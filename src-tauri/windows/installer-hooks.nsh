; Shell integration is created by the running app under the current user's
; registry hive. Tauri's default uninstaller does not know about that key, so
; remove it explicitly before the application files disappear.
Var RefreshDesktopShortcut

!macro NSIS_HOOK_PREINSTALL
  StrCpy $RefreshDesktopShortcut 0
  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" 0 +2
    StrCpy $RefreshDesktopShortcut 1
!macroend

; An in-place upgrade keeps the same executable path, which can leave Explorer
; showing a cached shortcut icon. Recreate an existing desktop shortcut and
; point it at a versioned ICO resource so Windows sees a new icon cache key.
!macro NSIS_HOOK_POSTINSTALL
  ${If} $RefreshDesktopShortcut = 1
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\yzai-desktop-v061.ico" 0 SW_SHOWNORMAL "" "${PRODUCTNAME}"
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\DesktopBackground\Shell\YZaiDesk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "YZaiDesk"
!macroend
