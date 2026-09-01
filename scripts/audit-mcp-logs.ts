import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { auditMcpLogSource } from './lib/audit-mcp-logs';

const repositoryRoot = join(import.meta.dirname, '..');
const sourceRoots = [join(repositoryRoot, 'applications/web/src')];

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.includes('.test.') &&
        !entry.name.includes('.spec.')
        ? [path]
        : [];
    }),
  );
  return nested.flat();
}

const files = (await Promise.all(sourceRoots.map(sourceFiles))).flat();
const findings = (
  await Promise.all(
    files.map(async (file) =>
      auditMcpLogSource(await readFile(file, 'utf8'), relative(repositoryRoot, file)),
    ),
  )
).flat();
if (findings.length > 0) {
  for (const finding of findings) console.error(`${finding.file}: ${finding.message}`);
  process.exitCode = 1;
} else {
  console.log(`MCP log audit passed for ${files.length} source files.`);
}
