!macro customHeader
  !system "chcp 65001 > nul"
!macroend

# ─────────────────────────────────────────────────────────────
#  覆盖升级专用 NSH
#
#  electron-builder 升级时会先静默执行旧版卸载器，旧卸载器会
#  un.atomicRMDir + RMDir /r $INSTDIR，把 resources\bundled 一起清掉。
#  本脚本在 customInit（.onInit，旧卸载器执行之前，此时 $INSTDIR 已
#  从注册表读出为上次安装目录）把 bundled 重命名到同级临时目录备份，
#  再在 customInstall（新文件释放之后）还原回去。
#  使用 Rename（同级目录、同盘符，瞬时完成），避免复制数百 MB。
#
#  注意：不使用 Var /GLOBAL，因为 electron-builder 会先用
#  BUILD_UNINSTALLER 编译卸载器，此时 customInit/customInstall 不会
#  被展开，全局变量未引用会导致 NSIS warning 6001。
#  备份路径在两个宏中分别用 StrCpy 重新计算，保证一致。
# ─────────────────────────────────────────────────────────────

!macro customInit
  ; 杀掉旧的 鲁南千易.exe 进程（失败也不影响安装继续）
  nsExec::ExecToLog 'taskkill /F /IM 鲁南千易.exe'
  ; 杀掉占用 39527 端口的 gateway 进程
  nsExec::ExecToLog 'powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 39527 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $$_.OwningProcess -Force -ErrorAction SilentlyContinue }"'

  ; 检查 Windows 版本 >= 10
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "鲁南千易 需要 Windows 10 或更高版本。"
    Quit
  ${EndIf}

  ; 检查磁盘空间 >= 2GB
  ${GetRoot} $INSTDIR $0
  ${DriveSpace} $0 "/D=F /S=M" $1
  ${If} $1 < 2048
    MessageBox MB_OK|MB_ICONSTOP "磁盘空间不足，至少需要 2GB 可用空间。$\n当前可用: $1 MB"
    Quit
  ${EndIf}

  ; ── 备份 bundled 目录（升级时旧卸载器会清空 $INSTDIR）──
  ; 备份到 $INSTDIR 的同级目录，保证同盘符 Rename 可瞬时完成
  StrCpy $R9 "$INSTDIR\..\lunanqianyi_bundled_upgrade_tmp"

  ${If} ${FileExists} "$INSTDIR\resources\bundled"
    ; 若上次升级中断残留了备份，优先保留既有备份，不覆盖
    ${IfNot} ${FileExists} "$R9"
      ClearErrors
      Rename "$INSTDIR\resources\bundled" "$R9"
      ${If} ${Errors}
        ClearErrors
        DetailPrint "备份 bundled 目录失败，跳过备份。"
      ${Else}
        DetailPrint "已备份 bundled 目录到 $R9"
      ${EndIf}
    ${Else}
      DetailPrint "检测到既有备份 $R9，跳过备份。"
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ; Ensure Details box shows output.
  SetDetailsPrint both

  ; ── 还原 bundled 目录 ──
  ; 重新计算备份路径（与 customInit 中一致）
  StrCpy $R9 "$INSTDIR\..\lunanqianyi_bundled_upgrade_tmp"

  ${If} ${FileExists} "$R9"
    ClearErrors
    Rename "$R9" "$INSTDIR\resources\bundled"
    ${If} ${Errors}
      ClearErrors
      DetailPrint "还原 bundled 目录失败，尝试复制..."
      CreateDirectory "$INSTDIR\resources\bundled"
      CopyFiles /SILENT "$R9\*.*" "$INSTDIR\resources\bundled"
      RMDir /r "$R9"
    ${Else}
      DetailPrint "已还原 bundled 目录到 $INSTDIR\resources\bundled"
    ${EndIf}
  ${EndIf}

  ; 创建开始菜单快捷方式
  CreateDirectory "$SMPROGRAMS\鲁南千易"
  CreateShortCut "$SMPROGRAMS\鲁南千易\卸载 鲁南千易.lnk" "$INSTDIR\Uninstall ${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\Uninstall ${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
  ; 删除桌面快捷方式
  ; 这里只删除开始菜单快捷方式
  Delete "$SMPROGRAMS\鲁南千易\卸载 鲁南千易.lnk"
  RMDir "$SMPROGRAMS\鲁南千易"
!macroend
