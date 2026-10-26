; Personnalisation de l'installeur NSIS (inclus par electron-builder).

!macro customUnInstall
  ; Retire le lancement automatique au démarrage de Windows créé par l'application.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MonBureauIntelligent"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "MonBureauIntelligent"

  ; Désinstallation complète (pas une mise à jour) : proposer de supprimer les données personnelles.
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Supprimer aussi vos données (tâches, notes, paramètres et sauvegardes) ?$\r$\n$\r$\nChoisissez « Non » pour les conserver en vue d'une réinstallation." /SD IDNO IDNO mbi_keep_data
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}
      RMDir /r "$APPDATA\Mon Bureau Intelligent"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    mbi_keep_data:
  ${endIf}
!macroend
