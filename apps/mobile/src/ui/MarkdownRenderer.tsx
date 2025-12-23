import React from 'react';
import { Platform, StyleSheet, Text as RNText, TextProps } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from './ThemeProvider';
import { spacing, radius } from './theme';

interface MarkdownRendererProps {
  content: string;
  /** When true, allows text to be selected and copied (useful for mobile) */
  selectable?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  selectable = false,
}) => {
  const { theme, isDark } = useTheme();

  const markdownStyles = StyleSheet.create({
    body: {
      color: theme.colors.foreground,
      fontSize: 14,
      lineHeight: 20,
    },
    heading1: {
      color: theme.colors.foreground,
      fontSize: 20,
      fontWeight: '700',
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    heading2: {
      color: theme.colors.foreground,
      fontSize: 18,
      fontWeight: '600',
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    heading3: {
      color: theme.colors.foreground,
      fontSize: 16,
      fontWeight: '600',
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    paragraph: {
      color: theme.colors.foreground,
      marginBottom: spacing.sm,
      lineHeight: 22,
    },
    strong: {
      fontWeight: '700',
    },
    em: {
      fontStyle: 'italic',
    },
    s: {
      textDecorationLine: 'line-through',
    },
    bullet_list: {
      marginBottom: spacing.sm,
    },
    ordered_list: {
      marginBottom: spacing.sm,
    },
    list_item: {
      marginBottom: spacing.xs,
    },
    bullet_list_icon: {
      color: theme.colors.mutedForeground,
      marginRight: spacing.xs,
    },
    ordered_list_icon: {
      color: theme.colors.mutedForeground,
      marginRight: spacing.xs,
    },
    code_inline: {
      backgroundColor: theme.colors.muted,
      color: theme.colors.primary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: radius.sm,
    },
    code_block: {
      backgroundColor: theme.colors.muted,
      color: theme.colors.foreground,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      padding: spacing.sm,
      borderRadius: radius.md,
      marginBottom: spacing.sm,
      overflow: 'hidden',
    },
    fence: {
      backgroundColor: theme.colors.muted,
      color: theme.colors.foreground,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      padding: spacing.sm,
      borderRadius: radius.md,
      marginBottom: spacing.sm,
      overflow: 'hidden',
    },
    blockquote: {
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.primary,
      paddingLeft: spacing.md,
      paddingVertical: spacing.xs,
      marginBottom: spacing.sm,
    },
    link: {
      color: theme.colors.primary,
      textDecorationLine: 'underline',
    },
    table: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: radius.sm,
      marginBottom: spacing.sm,
    },
    thead: {
      backgroundColor: theme.colors.muted,
    },
    th: {
      padding: spacing.sm,
      fontWeight: '600',
      borderBottomWidth: 1,
      borderColor: theme.colors.border,
    },
    tr: {
      borderBottomWidth: 1,
      borderColor: theme.colors.border,
    },
    td: {
      padding: spacing.sm,
    },
    hr: {
      backgroundColor: theme.colors.border,
      height: 1,
      marginVertical: spacing.md,
    },
  });

  // Custom render rules to make text selectable when the prop is enabled
  // This is especially useful for mobile where users need to copy LLM responses
  // IMPORTANT: Only apply 'selectable' to leaf text nodes that only contain text content.
  // Do NOT apply 'selectable' to container elements like paragraph/textgroup that could
  // contain non-text children (images, links with images, etc.) as React Native's <Text>
  // component cannot contain <View>/<Image> elements and would crash.
  const selectableRules = selectable ? {
    // Override the text rule to make text selectable (leaf node - always safe)
    text: (node: any, children: any, parent: any, styles: any) => (
      <RNText key={node.key} style={styles.text} selectable>
        {node.content}
      </RNText>
    ),
    // Override code_inline to make it selectable (leaf node - always safe)
    code_inline: (node: any, children: any, parent: any, styles: any) => (
      <RNText key={node.key} style={styles.code_inline} selectable>
        {node.content}
      </RNText>
    ),
    // Override code_block to make it selectable (leaf node - always safe)
    code_block: (node: any, children: any, parent: any, styles: any) => (
      <RNText key={node.key} style={styles.code_block} selectable>
        {node.content}
      </RNText>
    ),
    // Override fence (fenced code blocks) to make it selectable (leaf node - always safe)
    fence: (node: any, children: any, parent: any, styles: any) => (
      <RNText key={node.key} style={styles.fence} selectable>
        {node.content}
      </RNText>
    ),
  } : {};

  return (
    <Markdown
      style={markdownStyles}
      rules={selectableRules}
    >
      {content}
    </Markdown>
  );
};

export default MarkdownRenderer;

