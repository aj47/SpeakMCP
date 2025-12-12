import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from './ThemeProvider';
import { spacing, radius } from './theme';

interface MarkdownRendererProps {
  content: string;
  onLinkPress?: (url: string) => boolean;
  onTouchStart?: () => void;
}

/**
 * MarkdownRenderer with large fonts for voice-first UI
 * Inspired by Open Interpreter 01-app styling with big fonts
 * for better readability and accessibility on mobile
 *
 * The onTouchStart callback is triggered early in the touch lifecycle
 * to allow parent components to detect touches on markdown content
 * before the link's onPress fires (useful for hands-free mode).
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  onLinkPress,
  onTouchStart,
}) => {
  const { theme, isDark } = useTheme();

  // Use large typography from theme for voice-first UI
  const markdownStyles = StyleSheet.create({
    body: {
      color: theme.colors.foreground,
      fontSize: theme.typographyLarge.body.fontSize,
      lineHeight: theme.typographyLarge.body.lineHeight,
    },
    heading1: {
      color: theme.colors.foreground,
      fontSize: theme.typographyLarge.h1.fontSize,
      fontWeight: '700',
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    heading2: {
      color: theme.colors.foreground,
      fontSize: theme.typographyLarge.h2.fontSize,
      fontWeight: '600',
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    heading3: {
      color: theme.colors.foreground,
      fontSize: theme.typographyLarge.label.fontSize,
      fontWeight: '600',
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    paragraph: {
      color: theme.colors.foreground,
      marginBottom: spacing.sm,
      lineHeight: theme.typographyLarge.body.lineHeight,
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
      fontSize: theme.typographyLarge.caption.fontSize,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.sm,
    },
    code_block: {
      backgroundColor: theme.colors.muted,
      color: theme.colors.foreground,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: theme.typographyLarge.caption.fontSize,
      padding: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.sm,
      overflow: 'hidden',
    },
    fence: {
      backgroundColor: theme.colors.muted,
      color: theme.colors.foreground,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: theme.typographyLarge.caption.fontSize,
      padding: spacing.md,
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

  return (
    <View
      onStartShouldSetResponderCapture={() => {
        // Call onTouchStart early in touch lifecycle to mark as interactive
        // This runs before onPress, allowing parent to know a touch started here
        onTouchStart?.();
        return false; // Don't actually capture - let children handle their own events
      }}
    >
      <Markdown style={markdownStyles} onLinkPress={onLinkPress}>
        {content}
      </Markdown>
    </View>
  );
};

export default MarkdownRenderer;

