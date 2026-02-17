# Example Skills

This file contains complete, working examples of Agent Skills that you can use as templates.

## Example 1: Simple Skill - Git Commit Messages

A focused skill for writing better commit messages.

```markdown
---
name: git-commit-messages
description: "Guidelines for writing clear, conventional git commit messages. Use when creating commits or reviewing commit messages."
---

# Git Commit Message Guidelines

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

## Types
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation only
- **style**: Formatting, no code change
- **refactor**: Code restructuring
- **test**: Adding tests
- **chore**: Maintenance tasks

## Rules
1. Subject line ≤ 50 characters
2. Use imperative mood ("Add feature" not "Added feature")
3. Don't end subject with period
4. Wrap body at 72 characters
5. Explain what and why, not how

## Examples

Good:
```
feat(auth): add OAuth2 support for Google login

Implements OAuth2 flow for Google authentication.
Includes token refresh handling and secure storage.

Closes #123
```
```

---

## Example 2: Medium Skill - API Error Handling

A skill with workflow guidance and decision trees.

```markdown
---
name: api-error-handling
description: "Best practices for handling API errors in Node.js/Express applications. Use when implementing error handling, creating error middleware, or debugging API issues."
---

# API Error Handling

## Error Response Format

Always return consistent error responses:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": [...],
    "requestId": "uuid"
  }
}
```

## HTTP Status Code Decision Tree

1. Client error?
   - Invalid input → 400 Bad Request
   - Not authenticated → 401 Unauthorized
   - Not allowed → 403 Forbidden
   - Not found → 404 Not Found
   - Wrong method → 405 Method Not Allowed
   - Rate limited → 429 Too Many Requests

2. Server error?
   - Expected failure → 500 Internal Server Error
   - Dependency down → 503 Service Unavailable
   - Timeout → 504 Gateway Timeout

## Error Middleware Pattern

```typescript
// Error handler middleware (must be last)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_ERROR';
  
  // Log error with context
  logger.error({
    error: err.message,
    stack: err.stack,
    requestId: req.id,
    path: req.path,
    method: req.method,
  });

  // Don't leak stack traces in production
  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: err.message,
      requestId: req.id,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  });
});
```
```

---

## Example 3: Complex Skill with Supporting Files

A skill that references additional documentation.

```markdown
---
name: database-migrations
description: "Workflows for creating and running database migrations with TypeORM. Use when modifying database schema, creating migrations, or troubleshooting migration issues."
---

# Database Migrations

## Quick Reference

- Create: `npm run migration:create -- -n MigrationName`
- Generate: `npm run migration:generate -- -n MigrationName`
- Run: `npm run migration:run`
- Revert: `npm run migration:revert`

## Workflow: Adding a New Column

1. Update the entity file
2. Generate migration: `npm run migration:generate -- -n AddColumnToTable`
3. Review the generated migration
4. Run in dev: `npm run migration:run`
5. Test thoroughly
6. Commit entity + migration together

## Common Pitfalls

- ⚠️ Never modify a migration that's been deployed
- ⚠️ Always backup before running in production
- ⚠️ Test data migrations with production-like data

For detailed TypeORM patterns, see [typeorm-patterns.md](typeorm-patterns.md).
```

---

## Tips for Writing Good Skills

1. **Start small** - A 50-line skill that works is better than a 500-line skill that confuses
2. **Use examples** - Show, don't just tell
3. **Include commands** - Give copy-pasteable commands
4. **Add warnings** - Call out common mistakes with ⚠️
5. **Link to details** - Use supporting files for deep dives

