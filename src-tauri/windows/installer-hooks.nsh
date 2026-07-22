; Shell integration is created by the running app under the current user's
; registry hive. Tauri's default uninstaller does not know about that key, so
; remove it explicitly before the application files disappear.
!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\DesktopBackground\Shell\YZaiDesk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "YZaiDesk"
!macroend
