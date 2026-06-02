/**
 * Shared color utilities for CLI scripts.
 *
 * Provides consistent styling across all worktree scripts using chalk.
 */

import chalk from 'chalk';

/**
 * Success messages (green).
 */
export const success = chalk.green;

/**
 * Error messages (red).
 */
export const error = chalk.red;

/**
 * Warning messages (yellow).
 */
export const warning = chalk.yellow;

/**
 * Info/highlight messages (cyan).
 */
export const info = chalk.cyan;

/**
 * Dim/secondary text (gray).
 */
export const dim = chalk.dim;

/**
 * Bold text for emphasis.
 */
export const bold = chalk.bold;

/**
 * Label styling (bold cyan).
 */
export const label = chalk.bold.cyan;

/**
 * Value styling (white).
 */
export const value = chalk.white;

/**
 * Success checkmark.
 */
export const checkmark = success('✓');

/**
 * Error cross.
 */
export const cross = error('✗');

/**
 * Warning symbol.
 */
export const warningSymbol = warning('⚠');

/**
 * In-progress symbol.
 */
export const inProgressSymbol = info('⏳');

/**
 * Creates a styled phase header.
 */
export function phaseHeader(phaseName: string): string {
  const line = '═'.repeat(60);
  return ['', dim(line), bold.cyan(`  Phase: ${phaseName}`), dim(line)].join('\n');
}

/**
 * Creates a styled section header (for main script titles).
 */
export function sectionHeader(title: string): string {
  const line = '═'.repeat(60);
  return ['', info(line), bold.white(`  ${title}`), info(line)].join('\n');
}

/**
 * Creates a styled error header.
 */
export function errorHeader(title: string): string {
  const line = '═'.repeat(60);
  return ['', error(line), bold.red(`  ${title}`), error(line)].join('\n');
}

/**
 * Creates a styled summary header.
 */
export function summaryHeader(title: string): string {
  const line = '─'.repeat(60);
  return ['', dim(line), bold.green(`  ${title}`), dim(line)].join('\n');
}

/**
 * Detects whether a string already contains ANSI color/style codes.
 * This is used to avoid re-wrapping pre-styled values in `keyValue`.
 */
function hasAnsiCodes(text: string): boolean {
  // Matches standard ANSI SGR escape sequences like "\u001b[32m"
  // Using String.fromCharCode to avoid no-control-regex lint error
  const escapeChar = String.fromCharCode(0x1b);
  return text.includes(escapeChar);
}

/**
 * Formats a key-value pair for display.
 *
 * - Plain values are rendered in white via `value()`.
 * - Pre-styled (ANSI-colored) values are left as-is to preserve their styling.
 */
export function keyValue(key: string, val: string | number | boolean): string {
  const text = String(val);
  const styledValue = hasAnsiCodes(text) ? text : value(text);
  return `  ${dim(key + ':')} ${styledValue}`;
}

/**
 * Formats a list item with indentation.
 */
export function listItem(text: string, indent = 2): string {
  return ' '.repeat(indent) + dim('•') + ' ' + text;
}

/**
 * Formats a status message with appropriate color.
 */
export function status(type: 'success' | 'error' | 'warning' | 'info', message: string): string {
  const symbols = {
    success: checkmark,
    error: cross,
    warning: warningSymbol,
    info: info('→'),
  };
  // Use a local alias for the info color to avoid confusion with the 'info' status type.
  const infoColor = info;
  const colors = {
    success,
    error,
    warning,
    info: infoColor,
  };
  return `  ${symbols[type]} ${colors[type](message)}`;
}
