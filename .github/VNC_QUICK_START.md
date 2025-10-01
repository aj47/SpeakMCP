# VNC GUI Testing - Quick Start

Get up and running with VNC testing in 5 minutes!

## Prerequisites

- GitHub account with access to this repository
- ngrok account (free): https://ngrok.com
- VNC client (optional, can use web browser)

## Setup (One-Time)

### Step 1: Get ngrok Token

1. Sign up at https://ngrok.com (free)
2. Go to https://dashboard.ngrok.com/auth
3. Copy your auth token

### Step 2: Configure Secrets

**Option A: Using Script (Recommended)**

```bash
# Linux/macOS
./.github/setup-vnc-secrets.sh

# Windows PowerShell
.\.github\setup-vnc-secrets.ps1
```

**Option B: Manual Setup**

1. Go to your GitHub repository
2. Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Add these secrets:
   - Name: `NGROK_AUTH_TOKEN`, Value: (your ngrok token)
   - Name: `VNC_PASSWORD`, Value: (your password, max 8 chars) - Optional

## Running VNC Session

### Step 1: Start Workflow

1. Go to **Actions** tab in GitHub
2. Click **VNC GUI Testing** in the left sidebar
3. Click **Run workflow** button (top right)
4. Configure:
   - Enable VNC: `true`
   - Timeout: `60` (minutes)
   - Run tests: `false` (unless you want automated tests)
5. Click **Run workflow**

### Step 2: Get Connection Info

1. Click on the running workflow
2. Wait ~2-3 minutes for setup
3. Expand **"Setup ngrok tunnel"** step
4. Look for connection details:

```
============================================
VNC Connection Details:
============================================
VNC URL: tcp://0.tcp.ngrok.io:12345
VNC Password: github123

Web VNC (noVNC) URL: https://abc123.ngrok.io/vnc.html
============================================
```

### Step 3: Connect

**Option A: Web Browser (Easiest)**

1. Open the noVNC URL in your browser
2. Click "Connect"
3. Enter password
4. Done! You'll see the Linux desktop with SpeakMCP running

**Option B: VNC Client**

1. Open your VNC client
2. Enter: `0.tcp.ngrok.io:12345` (from the VNC URL, without `tcp://`)
3. Enter password when prompted
4. Done!

## VNC Clients

### Recommended Clients

- **RealVNC Viewer**: https://www.realvnc.com/en/connect/download/viewer/
- **TigerVNC**: https://tigervnc.org/
- **macOS Screen Sharing**: Built-in (Finder → Go → Connect to Server → vnc://...)

## Common Issues

### "Cannot connect to VNC"

- ✅ Check NGROK_AUTH_TOKEN is set in secrets
- ✅ Verify workflow is still running (not timed out)
- ✅ Try the web-based noVNC URL instead
- ✅ Check firewall settings

### "Password not working"

- ✅ Use password from workflow logs
- ✅ Default is `github123` if VNC_PASSWORD not set
- ✅ VNC passwords max 8 characters

### "App not visible"

- ✅ Check "Run Electron app" step for errors
- ✅ Look for minimized windows
- ✅ Click on desktop to activate

### "Workflow timed out"

- ✅ Increase timeout when starting workflow
- ✅ Max is 360 minutes (6 hours)
- ✅ Start a new workflow if needed

## What You Can Test

Once connected via VNC:

- ✅ Full GUI interaction
- ✅ Voice dictation features
- ✅ MCP tool integration
- ✅ Settings configuration
- ✅ OAuth flows
- ✅ TTS functionality
- ✅ Keyboard shortcuts
- ✅ All UI components

## Tips

- **Session Duration**: Set appropriate timeout (default 60 min)
- **Early Stop**: Cancel workflow to stop immediately
- **Multiple Tests**: Can run multiple workflows (GitHub Actions limits apply)
- **Logs**: Check workflow logs for debugging
- **Screenshots**: Automatically captured on failure

## Cost

- **GitHub Actions**: Free tier = 2,000 min/month (private repos)
- **ngrok**: Free tier is sufficient (1 connection at a time)
- **VNC**: Free, no additional cost

## Next Steps

- Read full guide: [VNC_TESTING_GUIDE.md](VNC_TESTING_GUIDE.md)
- Check automated testing: [test.yml](workflows/test.yml)
- Report issues: GitHub Issues

## Architecture Overview

```
GitHub Actions Runner (Ubuntu)
    ↓
Xvfb (Virtual Display)
    ↓
SpeakMCP Electron App
    ↓
x11vnc (VNC Server)
    ↓
ngrok (Public Tunnel)
    ↓
Your VNC Client / Browser
```

## Support

Need help? Check:
1. Full guide: `.github/VNC_TESTING_GUIDE.md`
2. Workflow logs in GitHub Actions
3. Open an issue with logs/screenshots

---

**Ready to test?** Go to Actions → VNC GUI Testing → Run workflow! 🚀

