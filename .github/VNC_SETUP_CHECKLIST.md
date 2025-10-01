# VNC Setup Checklist

Use this checklist to verify your VNC testing setup is complete and working.

## ✅ Pre-Setup Checklist

- [ ] GitHub account with repository access
- [ ] Repository has GitHub Actions enabled
- [ ] Familiar with GitHub Actions interface
- [ ] Have a VNC client installed (or will use web browser)

## ✅ Initial Setup (One-Time)

### 1. Get ngrok Account
- [ ] Signed up at https://ngrok.com
- [ ] Verified email address
- [ ] Logged into ngrok dashboard
- [ ] Located auth token at https://dashboard.ngrok.com/auth
- [ ] Copied auth token to clipboard

### 2. Configure GitHub Secrets

**Option A: Using Setup Script**
- [ ] Opened terminal in repository directory
- [ ] Ran setup script:
  - Linux/macOS: `./.github/setup-vnc-secrets.sh`
  - Windows: `.\.github\setup-vnc-secrets.ps1`
- [ ] Entered ngrok auth token when prompted
- [ ] Set VNC password (or accepted default)
- [ ] Verified secrets were created successfully

**Option B: Manual Configuration**
- [ ] Navigated to repository Settings
- [ ] Clicked "Secrets and variables" → "Actions"
- [ ] Added `NGROK_AUTH_TOKEN` secret
- [ ] Added `VNC_PASSWORD` secret (optional)
- [ ] Verified both secrets appear in list

### 3. Verify Files Exist
- [ ] `.github/workflows/vnc-gui-test.yml` exists
- [ ] `.github/workflows/test.yml` exists
- [ ] `.github/VNC_TESTING_GUIDE.md` exists
- [ ] `.github/VNC_QUICK_START.md` exists
- [ ] `.github/setup-vnc-secrets.sh` exists
- [ ] `.github/setup-vnc-secrets.ps1` exists

## ✅ First Test Run

### 1. Start Workflow
- [ ] Navigated to repository on GitHub
- [ ] Clicked "Actions" tab
- [ ] Found "VNC GUI Testing" in workflow list
- [ ] Clicked "Run workflow" button
- [ ] Configured options:
  - [ ] Enable VNC: `true`
  - [ ] Timeout: `60` minutes
  - [ ] Run tests: `false`
- [ ] Clicked green "Run workflow" button
- [ ] Workflow appears in list with yellow dot (running)

### 2. Monitor Progress
- [ ] Clicked on running workflow
- [ ] Watched steps execute:
  - [ ] Checkout repository ✓
  - [ ] Setup Node.js ✓
  - [ ] Setup Rust ✓
  - [ ] Install system dependencies ✓
  - [ ] Install Node dependencies ✓
  - [ ] Build Rust binary ✓
  - [ ] Build Electron app ✓
  - [ ] Start Xvfb ✓
  - [ ] Start window manager ✓
  - [ ] Setup VNC Server ✓
  - [ ] Setup noVNC ✓
  - [ ] Setup ngrok tunnel ✓

### 3. Get Connection Details
- [ ] Expanded "Setup ngrok tunnel" step
- [ ] Found VNC connection details section
- [ ] Copied VNC URL (e.g., `tcp://0.tcp.ngrok.io:12345`)
- [ ] Copied VNC password
- [ ] Copied noVNC web URL (optional)

### 4. Connect to VNC

**Option A: Web Browser (Recommended for First Test)**
- [ ] Opened noVNC URL in browser
- [ ] Saw noVNC interface load
- [ ] Clicked "Connect" button
- [ ] Entered VNC password
- [ ] Saw Linux desktop appear
- [ ] Saw SpeakMCP application window

**Option B: VNC Client**
- [ ] Opened VNC client application
- [ ] Entered VNC hostname and port
- [ ] Connected to server
- [ ] Entered password when prompted
- [ ] Saw Linux desktop appear
- [ ] Saw SpeakMCP application window

### 5. Test Application
- [ ] Application window is visible
- [ ] Can click on application
- [ ] Can interact with UI elements
- [ ] Can open settings
- [ ] Can navigate between screens
- [ ] Application responds to input

### 6. End Session
- [ ] Finished testing
- [ ] Returned to GitHub Actions
- [ ] Clicked "Cancel workflow" (or waited for timeout)
- [ ] Workflow stopped successfully
- [ ] VNC connection closed

## ✅ Verify Automated Testing

### 1. Run Test Workflow
- [ ] Navigated to Actions → "Test"
- [ ] Clicked "Run workflow"
- [ ] Workflow executed successfully
- [ ] All tests passed
- [ ] Build artifacts created

### 2. Run VNC with Tests
- [ ] Started "VNC GUI Testing" workflow
- [ ] Set "Run tests" to `true`
- [ ] Tests executed in GUI environment
- [ ] Test results visible in logs

## ✅ Documentation Review

- [ ] Read `.github/VNC_QUICK_START.md`
- [ ] Reviewed `.github/VNC_TESTING_GUIDE.md`
- [ ] Understand troubleshooting steps
- [ ] Know how to access logs
- [ ] Familiar with security considerations

## ✅ Troubleshooting Verification

### Test Common Issues

**Connection Issues**
- [ ] Know how to check NGROK_AUTH_TOKEN
- [ ] Can find ngrok URL in logs
- [ ] Can try web-based noVNC as fallback
- [ ] Understand firewall considerations

**Password Issues**
- [ ] Know where to find password in logs
- [ ] Understand 8-character limit
- [ ] Can update VNC_PASSWORD secret

**Application Issues**
- [ ] Can check "Run Electron app" logs
- [ ] Know how to capture screenshots
- [ ] Can access uploaded artifacts

**Timeout Issues**
- [ ] Know how to adjust timeout
- [ ] Understand 360-minute maximum
- [ ] Can start new workflow if needed

## ✅ Advanced Features

### Optional: Test Advanced Scenarios

**Custom Commands**
- [ ] Connected via VNC
- [ ] Opened terminal in VNC session
- [ ] Ran custom commands
- [ ] Tested specific features

**Multiple Sessions**
- [ ] Started multiple workflows (if needed)
- [ ] Managed concurrent sessions
- [ ] Understood GitHub Actions limits

**Debugging**
- [ ] Used VNC for debugging
- [ ] Inspected application state
- [ ] Reviewed logs in real-time
- [ ] Captured debug information

## ✅ Production Readiness

### Security
- [ ] Using strong VNC password
- [ ] Not sharing ngrok URLs publicly
- [ ] Setting appropriate timeouts
- [ ] Canceling workflows when done

### Cost Management
- [ ] Understand GitHub Actions quota
- [ ] Monitoring usage
- [ ] Setting appropriate timeouts
- [ ] Using free tier efficiently

### Team Onboarding
- [ ] Shared documentation with team
- [ ] Demonstrated VNC testing
- [ ] Documented team-specific workflows
- [ ] Established best practices

## ✅ Integration

### CI/CD Integration
- [ ] Test workflow runs on push
- [ ] Test workflow runs on PR
- [ ] Build artifacts uploaded
- [ ] Test results visible

### Development Workflow
- [ ] VNC testing integrated into workflow
- [ ] Team knows when to use VNC
- [ ] Documentation is accessible
- [ ] Process is documented

## 🎉 Setup Complete!

If you've checked all the boxes above, your VNC testing setup is complete and ready for use!

## Next Steps

1. **Regular Testing**: Use VNC for GUI testing as needed
2. **Team Training**: Share knowledge with team members
3. **Continuous Improvement**: Gather feedback and improve process
4. **Documentation**: Keep docs updated with learnings

## Quick Reference

### Start VNC Session
```
Actions → VNC GUI Testing → Run workflow
```

### Connect to VNC
```
1. Get URL from "Setup ngrok tunnel" step
2. Open in VNC client or browser
3. Enter password
4. Start testing!
```

### Get Help
```
1. Check .github/VNC_TESTING_GUIDE.md
2. Review workflow logs
3. Check troubleshooting section
4. Open GitHub issue if needed
```

## Support

Need help? Check:
- 📖 [Quick Start Guide](.github/VNC_QUICK_START.md)
- 📚 [Full Testing Guide](.github/VNC_TESTING_GUIDE.md)
- 📝 [Setup Summary](../VNC_SETUP_SUMMARY.md)
- 🐛 [GitHub Issues](https://github.com/aj47/SpeakMCP/issues)

---

**Happy Testing!** 🚀

