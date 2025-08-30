# Custom NSIS script for SpeakMCP installer
# Adds additional metadata and trust signals for Windows Defender

# Version information
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "SpeakMCP"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "SpeakMCP"
VIAddVersionKey "FileDescription" "AI-powered dictation tool with MCP integration"
VIAddVersionKey "FileVersion" "${VERSION}.0"
VIAddVersionKey "LegalCopyright" "© 2024 SpeakMCP"
VIAddVersionKey "OriginalFilename" "SpeakMCP-${VERSION}-setup.exe"

# Additional trust signals
RequestExecutionLevel admin
ShowInstDetails show
ShowUnInstDetails show

# Custom installer sections for better Windows integration
Section "Core Application" SecCore
    SectionIn RO  # Read-only, always installed
    
    # Set output path
    SetOutPath "$INSTDIR"
    
    # Add Windows Defender exclusion recommendation
    DetailPrint "Installing SpeakMCP..."
    DetailPrint "Note: You may need to add Windows Defender exclusions"
    DetailPrint "for optimal performance and to prevent false positives."
    
SectionEnd

# Uninstaller section
Section "Uninstall"
    # Remove application files
    Delete "$INSTDIR\*.*"
    RMDir /r "$INSTDIR"
    
    # Remove shortcuts
    Delete "$DESKTOP\SpeakMCP.lnk"
    Delete "$SMPROGRAMS\SpeakMCP\*.*"
    RMDir "$SMPROGRAMS\SpeakMCP"
    
    # Remove registry entries
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpeakMCP"
    DeleteRegKey HKLM "Software\SpeakMCP"
    
SectionEnd

# Function to check for Windows Defender and suggest exclusions
Function .onInstSuccess
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "Installation completed successfully!$\r$\n$\r$\n\
        For optimal performance, would you like to view instructions$\r$\n\
        for adding Windows Defender exclusions?" \
        IDNO skip_defender_info
        
    # Open documentation about Windows Defender exclusions
    ExecShell "open" "https://github.com/aj47/SpeakMCP/blob/main/WINDOWS_DEFENDER_SETUP.md"
    
    skip_defender_info:
FunctionEnd

# Function to add registry entries for better Windows integration
Function .onInstFinished
    # Add application information to registry
    WriteRegStr HKLM "Software\SpeakMCP" "InstallPath" "$INSTDIR"
    WriteRegStr HKLM "Software\SpeakMCP" "Version" "${VERSION}"
    WriteRegStr HKLM "Software\SpeakMCP" "Publisher" "SpeakMCP"
    
    # Add uninstall information
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpeakMCP" \
                     "DisplayName" "SpeakMCP"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpeakMCP" \
                     "DisplayVersion" "${VERSION}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpeakMCP" \
                     "Publisher" "SpeakMCP"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpeakMCP" \
                     "UninstallString" "$INSTDIR\Uninstall.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpeakMCP" \
                     "DisplayIcon" "$INSTDIR\SpeakMCP.exe"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpeakMCP" \
                      "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SpeakMCP" \
                      "NoRepair" 1
FunctionEnd
