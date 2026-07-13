#define MyAppName "Forkly"
#define MyAppPublisher "Forkly"
#define MyAppURL "https://github.com/tottiqq7788/forkly"
#ifndef MyAppVersion
#define MyAppVersion "0.1.0"
#endif
#ifndef MyAppArch
#define MyAppArch "x64"
#endif
#ifndef MyAppStage
#define MyAppStage "..\..\dist\windows-x64\Forkly"
#endif

[Setup]
AppId={{2BD92321-BE03-44E2-B39B-9D53D5AB3894}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\Forkly
DefaultGroupName=Forkly
AllowNoIcons=no
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DisableProgramGroupPage=no
UsePreviousAppDir=yes
UsePreviousGroup=yes
OutputDir=..\..\dist
OutputBaseFilename=Forkly-{#MyAppVersion}-windows-{#MyAppArch}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
UninstallDisplayIcon={app}\Forkly.exe
ChangesAssociations=yes
CloseApplications=yes
CloseApplicationsFilter=Forkly.exe

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "markdownassoc"; Description: "将 Markdown 文件（.md 等）默认使用 Forkly 打开"; GroupDescription: "文件关联："; Flags: checkedonce
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: unchecked

[Files]
Source: "{#MyAppStage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Forkly"; Filename: "{app}\Forkly.exe"; WorkingDir: "{app}"
Name: "{group}\卸载 Forkly"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Forkly"; Filename: "{app}\Forkly.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Classes\Forkly.Markdown"; ValueType: string; ValueName: ""; ValueData: "Forkly Markdown Document"; Flags: uninsdeletekey; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\Forkly.Markdown\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\Forkly.exe,0"; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\Forkly.Markdown\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Forkly.exe"" ""%1"""; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\Applications\Forkly.exe\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Forkly.exe"" ""%1"""; Flags: uninsdeletekey; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\.md"; ValueType: string; ValueName: ""; ValueData: "Forkly.Markdown"; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\.markdown"; ValueType: string; ValueName: ""; ValueData: "Forkly.Markdown"; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\.mdown"; ValueType: string; ValueName: ""; ValueData: "Forkly.Markdown"; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\.mkdn"; ValueType: string; ValueName: ""; ValueData: "Forkly.Markdown"; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\.mkd"; ValueType: string; ValueName: ""; ValueData: "Forkly.Markdown"; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\.mdwn"; ValueType: string; ValueName: ""; ValueData: "Forkly.Markdown"; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\.mdtxt"; ValueType: string; ValueName: ""; ValueData: "Forkly.Markdown"; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\.mdtext"; ValueType: string; ValueName: ""; ValueData: "Forkly.Markdown"; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: none; ValueName: "Forkly.Markdown"; Tasks: markdownassoc
Root: HKCU; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: none; ValueName: "Forkly.Markdown"; Tasks: markdownassoc

[Run]
Filename: "{app}\Forkly.exe"; Description: "启动 Forkly"; Flags: nowait postinstall skipifsilent unchecked
Filename: "{cmd}"; Parameters: "/C assoc .md=Forkly.Markdown >NUL 2>NUL"; Flags: runhidden; Tasks: markdownassoc
Filename: "{cmd}"; Parameters: "/C assoc .markdown=Forkly.Markdown >NUL 2>NUL"; Flags: runhidden; Tasks: markdownassoc
Filename: "{sys}\ie4uinit.exe"; Parameters: "-show"; Flags: runhidden skipifdoesntexist; Tasks: markdownassoc

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
