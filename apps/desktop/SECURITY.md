# Security Policy for SpeakMCP

## 🔒 Security Overview

SpeakMCP is designed with security as a primary concern. This document outlines our security policies, vulnerability reporting procedures, and best practices for users and contributors.

## 🛡️ Security Features

### Data Protection
- **Local Storage**: All user data is stored locally on the user's machine
- **No Cloud Sync**: No data is transmitted to external servers
- **Encrypted Storage**: Sensitive API keys are encrypted using electron-store
- **Memory Protection**: API keys are cleared from memory after use

### API Key Management
- **Secure Storage**: API keys are stored using electron-safe-storage
- **Access Control**: Keys are only accessible to the main process
- **Validation**: All API keys are validated before use
- **Rotation Support**: Support for key rotation and revocation

### Network Security
- **HTTPS Only**: All API calls use HTTPS
- **Certificate Validation**: SSL certificate validation enabled
- **No Proxy Bypass**: Network requests cannot bypass system proxy settings
- **Rate Limiting**: Built-in rate limiting for API calls

## 🚨 Vulnerability Reporting

### How to Report
- **Email**: security@speakmcp.com
- **GitHub**: Create a security advisory on our GitHub repository
- **Responsible Disclosure**: 90-day disclosure timeline

### What to Report
- Security vulnerabilities in the application
- Issues with API key handling
- Privacy concerns
- Malicious code injection possibilities

## 🔐 Best Practices for Users

### API Key Management
1. **Use Environment Variables**: Store API keys in environment variables when possible
2. **Regular Rotation**: Rotate API keys regularly
3. **Least Privilege**: Use API keys with minimal required permissions
4. **Monitor Usage**: Monitor API usage for unusual activity

### Application Security
1. **Keep Updated**: Always use the latest version
2. **Verify Downloads**: Verify checksums and signatures
3. **Secure Environment**: Run in secure computing environments
4. **Access Control**: Limit application access to necessary resources

## 🏗️ Secure Development Practices

### Code Review
- **Security Review**: All code changes undergo security review
- **Static Analysis**: Automated security scanning of all code
- **Dependency Scanning**: Regular scanning of dependencies for vulnerabilities
- **Penetration Testing**: Regular third-party security assessments

### Build Security
- **Reproducible Builds**: All builds are reproducible
- **Code Signing**: All releases are cryptographically signed
- **Supply Chain**: Secure supply chain management
- **Integrity Checks**: Build integrity verification

## 📋 Incident Response

### Response Team
- **Primary Contact**: security@speakmcp.com
- **Response Time**: 24-48 hours for critical issues
- **Communication**: Transparent public communication about security issues

### Response Process
1. **Triage**: Initial assessment within 4 hours
2. **Investigation**: Full investigation within 24 hours
3. **Fix**: Patch development within 7 days
4. **Release**: Security fix release within 14 days

## 🔍 Security Scanning

### Automated Scanning
- **SAST**: Static Application Security Testing
- **DAST**: Dynamic Application Security Testing
- **Dependency Scanning**: Third-party dependency vulnerability scanning
- **Container Scanning**: Container image vulnerability scanning

### Manual Testing
- **Penetration Testing**: Quarterly third-party penetration tests
- **Code Review**: Security-focused code review
- **Architecture Review**: Regular security architecture review

## 📞 Contact Information

### Security Team
- **Email**: security@speakmcp.com
- **PGP Key**: Available on keybase.io/speakmcp
- **Emergency**: Use GitHub security advisories for urgent issues

### Response SLA
- **Critical**: 4 hours
- **High**: 24 hours
- **Medium**: 72 hours
- **Low**: 7 days

## 📄 License

This security policy is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

Last updated: 2025-08-14
