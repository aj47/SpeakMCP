import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from './ThemeProvider';
import { spacing, radius } from './theme';

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
}) => {
  const { theme, isDark } = useTheme();

  // Compact markdown styles matching desktop's tight layout
  const markdownStyles = StyleSheet.create({
    body: {
      color: theme.colors.foreground,
      fontSize: 13,
      lineHeight: 18,
    },
    heading1: {
      color: theme.colors.foreground,
      fontSize: 16,
      fontWeight: '700',
      marginTop: spacing.xs,
      marginBottom: 2,
    },
    heading2: {
      color: theme.colors.foreground,
      fontSize: 15,
      fontWeight: '600',
      marginTop: spacing.xs,
      marginBottom: 2,
    },
    heading3: {
      color: theme.colors.foreground,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 2,
      marginBottom: 1,
    },
    paragraph: {
      color: theme.colors.foreground,
      marginBottom: spacing.xs,
      lineHeight: 18,
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
      marginBottom: spacing.xs,
    },
    ordered_list: {
      marginBottom: spacing.xs,
    },
    list_item: {
      marginBottom: 1,
    },
    bullet_list_icon: {
      color: theme.colors.mutedForeground,
      marginRight: 2,
    },
    ordered_list_icon: {
      color: theme.colors.mutedForeground,
      marginRight: 2,
    },
    code_inline: {
      backgroundColor: theme.colors.muted,
      color: theme.colors.primary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      paddingHorizontal: 3,
      paddingVertical: 1,
      borderRadius: radius.sm,
    },
    code_block: {
      backgroundColor: theme.colors.muted,
      color: theme.colors.foreground,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 10,
      padding: spacing.xs,
      borderRadius: radius.sm,
      marginBottom: spacing.xs,
      overflow: 'hidden',
    },
    fence: {
      backgroundColor: theme.colors.muted,
      color: theme.colors.foreground,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 10,
      padding: spacing.xs,
      borderRadius: radius.sm,
      marginBottom: spacing.xs,
      overflow: 'hidden',
    },
    blockquote: {
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.primary,
      paddingLeft: spacing.sm,
      paddingVertical: 2,
      marginBottom: spacing.xs,
    },
    link: {
      color: theme.colors.primary,
      textDecorationLine: 'underline',
    },
    table: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: radius.sm,
      marginBottom: spacing.xs,
    },
    thead: {
      backgroundColor: theme.colors.muted,
    },
    th: {
      padding: spacing.xs,
      fontWeight: '600',
      borderBottomWidth: 1,
      borderColor: theme.colors.border,
      fontSize: 11,
    },
    tr: {
      borderBottomWidth: 1,
      borderColor: theme.colors.border,
    },
    td: {
      padding: spacing.xs,
      fontSize: 11,
    },
    hr: {
      backgroundColor: theme.colors.border,
      height: 1,
      marginVertical: spacing.xs,
    },
  });

  return (
    <Markdown style={markdownStyles}>
      {content}
    </Markdown>
  );
};

export default MarkdownRenderer;

