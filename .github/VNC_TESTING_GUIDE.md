# VNC GUI Testing Guide for SpeakMCP

This guide explains how to use the VNC-enabled GitHub Actions workflow to test the SpeakMCP Electron application in a full Linux desktop environment.

## Overview

The VNC GUI Testing workflow allows you to:
- Run SpeakMCP in a real Linux desktop environment on GitHub Actions
- Connect remotely via VNC to interact with the application
- Run automated tests in a GUI environment
- Debug GUI-related issues
- Test the full application stack including Electron, React UI, and Rust binary

## Prerequisites

### Required Secrets

To enable remote VNC access, you need to configure these GitHub repository secrets:

1. **NGROK_AUTH_TOKEN** (Required for remote access)
   - Sign up at [ngrok.com](https://ngrok.com)
   - Get your auth token from [ngrok dashboard](https://dashboard.ngrok.com/auth)
   - Add it to GitHub: Settings → Secrets and variables → Actions → New repository secret
   - Name: `NGROK_AUTH_TOKEN`
   - Value: Your ngrok auth token

2. **VNC_PASSWORD** (Optional, defaults to 'github123')
   - Add a custom VNC password for security
   - Name: `VNC_PASSWORD`
   - Value: Your desired password (max 8 characters for VNC compatibility)

### VNC Client Software

To connect to the VNC session, you'll need a VNC client:

**Desktop Clients:**
- **RealVNC Viewer** (Windows/Mac/Linux) - [Download](https://www.realvnc.com/en/connect/download/viewer/)
- **TigerVNC** (Windows/Mac/Linux) - [Download](https://tigervnc.org/)
- **TightVNC** (Windows) - [Download](https://www.tightvnc.com/)
- **Remmina** (Linux) - Usually pre-installed or `sudo apt install remmina`
- **Screen Sharing** (macOS) - Built-in, use Finder → Go → Connect to Server

**Web Browser:**
- No installation needed! Use the noVNC web interface provided in the workflow output

## How to Use

### Starting a VNC Session

1. **Navigate to Actions tab** in your GitHub repository
2. **Select "VNC GUI Testing"** workflow from the left sidebar
3. **Click "Run workflow"** button (top right)
4. **Configure options:**
   - **Enable VNC access**: Choose `true` for interactive testing
   - **VNC session timeout**: Set duration in minutes (default: 60, max: 360)
   - **Run automated tests**: Choose `true` to run test suite
5. **Click "Run workflow"** to start

### Connecting to VNC

Once the workflow starts, follow these steps:

1. **Wait for setup** (usually 2-3 minutes)
   - The workflow will install dependencies
   - Build the Rust binary
   - Build the Electron app
   - Start VNC server and ngrok tunnel

2. **Get connection details**
   - Click on the running workflow
   - Expand the "Setup ngrok tunnel" step
   - Look for the connection details section:
   ```
   ============================================
   VNC Connection Details:
   ============================================
   VNC URL: tcp://0.tcp.ngrok.io:12345
   VNC Password: github123
   
   Web VNC (noVNC) URL: https://abc123.ngrok.io/vnc.html
   ============================================
   ```

3. **Connect using VNC client**
   - Open your VNC client
   - Enter the VNC URL (without `tcp://` prefix, just the hostname:port)
   - Example: `0.tcp.ngrok.io:12345`
   - Enter the password when prompted

4. **Or connect via web browser**
   - Open the noVNC URL in your browser
   - Click "Connect"
   - Enter the VNC password
   - You'll see the Linux desktop with SpeakMCP running

### Interacting with the Application

Once connected:
- You'll see a Linux desktop (Fluxbox window manager)
- SpeakMCP should be running and visible
- You can interact with the application normally
- Test all features including:
  - Voice dictation
  - MCP tool integration
  - Settings configuration
  - OAuth flows
  - TTS functionality
  - UI interactions

### Session Management

- **Session duration**: Controlled by the `vnc_timeout` parameter
- **Early termination**: Cancel the workflow run to stop immediately
- **Automatic cleanup**: All processes are cleaned up when the workflow ends
- **Logs and screenshots**: Automatically uploaded as artifacts if there are failures

## Workflow Options Explained

### Enable VNC Access
- **true**: Starts VNC server and ngrok tunnel for remote access
- **false**: Runs in headless mode (useful for automated testing only)

### VNC Session Timeout
- Duration in minutes the VNC session stays active
- Default: 60 minutes
- Maximum: 360 minutes (6 hours)
- Set based on your testing needs

### Run Automated Tests
- **true**: Executes `npm run test:run` in the GUI environment
- **false**: Only starts the application without running tests
- Tests run with `xvfb-run` for proper display handling

## Architecture

The workflow sets up the following components:

```
┌─────────────────────────────────────────┐
│         GitHub Actions Runner           │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  Xvfb (Virtual Display :99)       │ │
│  │  ┌─────────────────────────────┐  │ │
│  │  │  Fluxbox Window Manager     │  │ │
│  │  │  ┌───────────────────────┐  │  │ │
│  │  │  │  SpeakMCP Electron    │  │  │ │
│  │  │  │  Application          │  │  │ │
│  │  │  └───────────────────────┘  │  │ │
│  │  └─────────────────────────────┘  │ │
│  └───────────────────────────────────┘ │
│           ↓                             │
│  ┌───────────────────────────────────┐ │
│  │  x11vnc (VNC Server :5901)        │ │
│  └───────────────────────────────────┘ │
│           ↓                             │
│  ┌───────────────────────────────────┐ │
│  │  noVNC (Web Client :6080)         │ │
│  └───────────────────────────────────┘ │
│           ↓                             │
│  ┌───────────────────────────────────┐ │
│  │  ngrok (Public Tunnel)            │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
           ↓
    Internet (You!)
```

## Troubleshooting

### Cannot connect to VNC

**Problem**: VNC client cannot connect to the provided URL

**Solutions**:
1. Check that NGROK_AUTH_TOKEN is properly set in repository secrets
2. Verify the ngrok URL in the workflow logs
3. Try the web-based noVNC interface instead
4. Check your firewall settings
5. Ensure the workflow is still running (not timed out)

### Application not visible

**Problem**: Connected to VNC but don't see the application

**Solutions**:
1. Check the "Run Electron app" step logs for errors
2. Look for the application window (might be minimized)
3. Try clicking on the desktop to activate windows
4. Check if the app crashed (look at workflow logs)

### VNC password not working

**Problem**: VNC password is rejected

**Solutions**:
1. Use the password shown in the workflow logs
2. If you set VNC_PASSWORD secret, ensure it's 8 characters or less
3. Try the default password: `github123`
4. Check for typos in the password

### Workflow times out

**Problem**: Workflow stops before you finish testing

**Solutions**:
1. Increase the `vnc_timeout` parameter when starting the workflow
2. Maximum timeout is 360 minutes (6 hours)
3. Start a new workflow run if needed

### Display issues

**Problem**: Screen resolution is wrong or display looks corrupted

**Solutions**:
1. The default resolution is 1920x1080x24
2. You can modify the workflow to change SCREEN_WIDTH, SCREEN_HEIGHT, SCREEN_DEPTH
3. Reconnect your VNC client after changing settings

## Advanced Usage

### Running Custom Commands

You can modify the workflow to run custom commands:

1. Fork the repository
2. Edit `.github/workflows/vnc-gui-test.yml`
3. Add your custom steps after the "Run Electron app" step
4. Commit and push your changes

### Debugging Specific Features

To debug specific features:

1. Start the VNC session
2. Connect via VNC
3. Open a terminal in the VNC session
4. Run commands manually:
   ```bash
   cd /home/runner/work/SpeakMCP/SpeakMCP
   npm run dev  # Start in development mode
   ```

### Capturing Debug Information

The workflow automatically:
- Captures screenshots on failure
- Uploads VNC and ngrok logs
- Saves test results

Access these from the workflow run page under "Artifacts"

## Security Considerations

- **VNC Password**: Use a strong password via VNC_PASSWORD secret
- **ngrok Tunnel**: Temporary and expires when workflow ends
- **Session Timeout**: Set appropriate timeout to avoid unnecessary resource usage
- **Secrets**: Never commit NGROK_AUTH_TOKEN or VNC_PASSWORD to the repository

## Performance Notes

- **Startup Time**: ~2-3 minutes for full environment setup
- **VNC Latency**: Depends on your internet connection and ngrok routing
- **Resource Usage**: GitHub Actions provides 2-core CPU, 7GB RAM
- **Concurrent Sessions**: Limited by GitHub Actions concurrent job limits

## Cost Considerations

- **GitHub Actions**: Free tier includes 2,000 minutes/month for private repos
- **ngrok**: Free tier is sufficient for testing (limited to 1 connection at a time)
- **VNC Session**: Each minute counts toward your GitHub Actions quota

## Alternative: Headless Testing

For automated testing without VNC:

```bash
# Run tests locally with xvfb
xvfb-run npm test

# Or in the workflow, set:
# - enable_vnc: false
# - run_tests: true
```

## Support

If you encounter issues:
1. Check the workflow logs for detailed error messages
2. Review this guide's troubleshooting section
3. Open an issue on the GitHub repository
4. Include workflow logs and screenshots if applicable

## References

- [Xvfb Documentation](https://www.x.org/releases/X11R7.6/doc/man/man1/Xvfb.1.xhtml)
- [x11vnc Documentation](https://github.com/LibVNC/x11vnc)
- [ngrok Documentation](https://ngrok.com/docs)
- [noVNC Documentation](https://github.com/novnc/noVNC)
- [Electron Testing Guide](https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci)

