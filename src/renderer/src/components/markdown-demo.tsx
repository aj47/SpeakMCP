import React from "react"
import { MarkdownRenderer } from "./markdown-renderer"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"

const sampleMarkdownWithThink = `# Agent Response Example

Here's a sample agent response that demonstrates both **markdown rendering** and collapsible thinking sections.

<think>
Let me think about this problem step by step:

1. First, I need to understand what the user is asking
2. Then I should consider the best approach
3. Finally, I'll provide a comprehensive solution

This is a complex problem that requires careful consideration. I should:
- Analyze the requirements
- Consider edge cases
- Provide clear examples

\`\`\`javascript
// Some thinking code
function analyzeRequest(input) {
  return input.split(' ').map(word => word.toLowerCase());
}
\`\`\`
</think>

## My Response

Based on your question, here's what I recommend:

### Key Points

1. **First Point**: This is important because it establishes the foundation
2. **Second Point**: This builds upon the first point
3. **Third Point**: This provides the final solution

### Code Example

Here's a simple implementation:

\`\`\`typescript
interface UserRequest {
  id: string;
  content: string;
  timestamp: Date;
}

function processRequest(request: UserRequest): string {
  // Process the request
  return \`Processed: \${request.content}\`;
}
\`\`\`

<think>
Actually, let me reconsider this approach. Maybe there's a better way to handle this:

- Option A: Use a simple string replacement
- Option B: Use a more sophisticated parser
- Option C: Implement a custom solution

I think Option B would be best because it's more robust and handles edge cases better.
</think>

### Additional Considerations

> **Note**: This is a blockquote that provides additional context and important information that users should be aware of.

For more complex scenarios, you might want to consider:

- Using a state management library
- Implementing proper error handling
- Adding comprehensive tests

### Table Example

| Feature | Status | Priority |
|---------|--------|----------|
| Markdown | ✅ Complete | High |
| Think Sections | ✅ Complete | High |
| Syntax Highlighting | ✅ Complete | Medium |

That's the complete solution! Let me know if you need any clarification.`

export const MarkdownDemo: React.FC = () => {
  return (
    <div className="space-y-6 p-6">
      <Card className="liquid-glass-subtle glass-border">
        <CardHeader>
          <CardTitle>Markdown Rendering Demo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            This demonstrates the new markdown rendering with collapsible
            &lt;think&gt; sections:
          </p>
          <div className="rounded-lg border bg-background/50 p-4">
            <MarkdownRenderer content={sampleMarkdownWithThink} />
          </div>
        </CardContent>
      </Card>

      <Card className="liquid-glass-subtle glass-border">
        <CardHeader>
          <CardTitle>Features Implemented</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              <strong>Markdown Rendering:</strong> Full support for headers,
              lists, code blocks, tables, etc.
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              <strong>Collapsible Think Sections:</strong> &lt;think&gt; tags
              are automatically converted to collapsible sections
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              <strong>Syntax Highlighting:</strong> Code blocks have proper
              syntax highlighting
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              <strong>Dark Mode Support:</strong> Proper styling for both light
              and dark themes
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              <strong>Responsive Design:</strong> Works well on different screen
              sizes
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
