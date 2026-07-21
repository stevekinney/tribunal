import { describe, expect, it } from 'vitest';

import {
  bold,
  checkmark,
  cross,
  dim,
  error,
  errorHeader,
  info,
  inProgressSymbol,
  keyValue,
  label,
  listItem,
  phaseHeader,
  sectionHeader,
  status,
  success,
  summaryHeader,
  value,
  warning,
  warningSymbol,
} from './colors';

describe('color primitives', () => {
  it('renders text through each chalk-backed helper', () => {
    expect(success('ok')).toContain('ok');
    expect(error('bad')).toContain('bad');
    expect(warning('careful')).toContain('careful');
    expect(info('fyi')).toContain('fyi');
    expect(dim('quiet')).toContain('quiet');
    expect(bold('loud')).toContain('loud');
    expect(label('name')).toContain('name');
    expect(value('42')).toContain('42');
  });

  it('exposes pre-composed status symbols', () => {
    expect(checkmark).toContain('✓');
    expect(cross).toContain('✗');
    expect(warningSymbol).toContain('⚠');
    expect(inProgressSymbol).toContain('⏳');
  });
});

describe('phaseHeader', () => {
  it('wraps the phase name between rule lines', () => {
    const header = phaseHeader('Deploy');
    expect(header).toContain('Phase: Deploy');
    expect(header.split('\n')).toHaveLength(4);
  });
});

describe('sectionHeader', () => {
  it('wraps the title between rule lines', () => {
    const header = sectionHeader('Verification');
    expect(header).toContain('Verification');
    expect(header.split('\n')).toHaveLength(4);
  });
});

describe('errorHeader', () => {
  it('wraps the title between error-colored rule lines', () => {
    const header = errorHeader('Failure');
    expect(header).toContain('Failure');
    expect(header.split('\n')).toHaveLength(4);
  });
});

describe('summaryHeader', () => {
  it('wraps the title between summary rule lines', () => {
    const header = summaryHeader('Results');
    expect(header).toContain('Results');
    expect(header.split('\n')).toHaveLength(4);
  });
});

describe('keyValue', () => {
  it('styles plain string values', () => {
    const line = keyValue('Branch', 'main');
    expect(line).toContain('Branch:');
    expect(line).toContain('main');
  });

  it('styles numeric and boolean values', () => {
    expect(keyValue('Count', 3)).toContain('3');
    expect(keyValue('Ready', true)).toContain('true');
  });

  it('leaves pre-styled ANSI values untouched', () => {
    const preStyled = success('done');
    const line = keyValue('Status', preStyled);
    expect(line).toContain(preStyled);
  });
});

describe('listItem', () => {
  it('indents the default amount', () => {
    const item = listItem('entry');
    expect(item.startsWith('  ')).toBe(true);
    expect(item).toContain('entry');
  });

  it('honors a custom indent', () => {
    const item = listItem('entry', 4);
    expect(item.startsWith('    ')).toBe(true);
  });
});

describe('status', () => {
  it('formats a success message', () => {
    const line = status('success', 'All checks passed');
    expect(line).toContain('All checks passed');
    expect(line).toContain('✓');
  });

  it('formats an error message', () => {
    const line = status('error', 'Something broke');
    expect(line).toContain('Something broke');
    expect(line).toContain('✗');
  });

  it('formats a warning message', () => {
    const line = status('warning', 'Careful now');
    expect(line).toContain('Careful now');
    expect(line).toContain('⚠');
  });

  it('formats an info message', () => {
    const line = status('info', 'FYI');
    expect(line).toContain('FYI');
    expect(line).toContain('→');
  });
});
