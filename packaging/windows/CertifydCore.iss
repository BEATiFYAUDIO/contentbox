#ifndef SourceDir
  #error SourceDir must be supplied by scripts\build-windows-installer.ps1
#endif

#ifndef OutputDir
  #error OutputDir must be supplied by scripts\build-windows-installer.ps1
#endif

#ifndef AppVersion
  #define AppVersion "0.1.0-beta"
#endif

[Setup]
AppId={{6A48F773-4382-4B42-A816-9B7F83E35D4C}
AppName=Certifyd Core
AppVersion={#AppVersion}
AppPublisher=Certifyd
AppPublisherURL=https://certifyd.me
AppSupportURL=https://certifyd.me
AppUpdatesURL=https://certifyd.me
DefaultDirName={localappdata}\Certifyd Core
DefaultGroupName=Certifyd Core
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=Certifyd-Core-Setup-{#AppVersion}-win-x64
SetupIconFile={#SourceDir}\assets\certifyd-core.ico
UninstallDisplayIcon={app}\assets\certifyd-core.ico
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
WizardStyle=modern
DisableDirPage=no

[Files]
Source: "{#SourceDir}\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\assets\certifyd-core.ico"; DestDir: "{app}\assets"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Certifyd Core\Certifyd Core"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launcher\CertifydCore.Launcher.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\certifyd-core.ico"
Name: "{autoprograms}\Certifyd Core\Certifyd Core (LAN Access)"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launcher\CertifydCore.Launcher.ps1"" -Lan"; WorkingDir: "{app}"; IconFilename: "{app}\assets\certifyd-core.ico"
Name: "{autoprograms}\Certifyd Core\Stop Certifyd Core"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\launcher\CertifydCore.Stop.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\certifyd-core.ico"
Name: "{autoprograms}\Certifyd Core\Certifyd Core Status"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\launcher\CertifydCore.Status.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\certifyd-core.ico"
Name: "{autodesktop}\Certifyd Core"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launcher\CertifydCore.Launcher.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\certifyd-core.ico"; Tasks: desktopicon
Name: "{autodesktop}\Certifyd Core (LAN Access)"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launcher\CertifydCore.Launcher.ps1"" -Lan"; WorkingDir: "{app}"; IconFilename: "{app}\assets\certifyd-core.ico"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "launchafterinstall"; Description: "Launch Certifyd Core after installation"; GroupDescription: "After install:"; Flags: checkedonce

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launcher\CertifydCore.Launcher.ps1"""; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent; Tasks: launchafterinstall

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
