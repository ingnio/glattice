; Extra steps for the NSIS installer, wired in from tauri.conf.json
; (bundle > windows > nsis > installerHooks).
;
; They look after the ".gif" file-type entry. The stock install step
; saves whatever ".gif" pointed at before and restores it on uninstall.
; That works for a first install, but installing over an existing copy
; saves Glattice's own entry as "the previous one", so a later uninstall
; restores a pointer to a file type that no longer exists.
;
; GLATTICE_GIF_CLASS must match the "name" of the gif entry under
; bundle > fileAssociations. GLATTICE_GIF_CLASS_OLD is the name used up
; to 0.2.0 builds made before this file existed.

!define GLATTICE_GIF_CLASS "Glattice.AnimatedGif"
!define GLATTICE_GIF_CLASS_OLD "Animated GIF"

; If ".gif" currently points at CLASS (a Glattice entry), point it back
; at what it pointed to before Glattice, or at nothing.
!macro GLATTICE_GIF_RELEASE CLASS
  ReadRegStr $R1 SHCTX "Software\Classes\.gif" ""
  ${If} $R1 == "${CLASS}"
    ReadRegStr $R2 SHCTX "Software\Classes\.gif" "${CLASS}_backup"
    ${If} $R2 == ""
    ${OrIf} $R2 == "${GLATTICE_GIF_CLASS}"
    ${OrIf} $R2 == "${GLATTICE_GIF_CLASS_OLD}"
      DeleteRegValue SHCTX "Software\Classes\.gif" ""
    ${Else}
      WriteRegStr SHCTX "Software\Classes\.gif" "" "$R2"
    ${EndIf}
  ${EndIf}
  DeleteRegValue SHCTX "Software\Classes\.gif" "${CLASS}_backup"
!macroend

; Before installing: undo any earlier Glattice entry, so the install
; step that follows saves the real previous value, not Glattice's own.
!macro NSIS_HOOK_PREINSTALL
  !insertmacro GLATTICE_GIF_RELEASE "${GLATTICE_GIF_CLASS}"
  !insertmacro GLATTICE_GIF_RELEASE "${GLATTICE_GIF_CLASS_OLD}"
  ; Remove the old, generically named file type, but only if it is the
  ; one Glattice created (its open command runs this install's exe).
  ReadRegStr $R1 SHCTX "Software\Classes\${GLATTICE_GIF_CLASS_OLD}\shell\open\command" ""
  ${If} $R1 == '$INSTDIR\${MAINBINARYNAME}.exe "%1"'
    DeleteRegKey SHCTX "Software\Classes\${GLATTICE_GIF_CLASS_OLD}"
  ${EndIf}
!macroend

; After uninstalling: make sure ".gif" is not left pointing at Glattice.
!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro GLATTICE_GIF_RELEASE "${GLATTICE_GIF_CLASS}"
  !insertmacro GLATTICE_GIF_RELEASE "${GLATTICE_GIF_CLASS_OLD}"
!macroend
