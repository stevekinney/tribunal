import ts from 'typescript';

type SynchronousSubprocessName = 'spawnSync' | 'execFileSync' | 'execSync';

function isSynchronousSubprocessName(value: string): value is SynchronousSubprocessName {
  return value === 'spawnSync' || value === 'execFileSync' || value === 'execSync';
}

function isChildProcessRequire(expression: ts.Expression | undefined): boolean {
  return Boolean(
    expression &&
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'require' &&
    expression.arguments.length === 1 &&
    ts.isStringLiteral(expression.arguments[0]) &&
    expression.arguments[0].text === 'node:child_process',
  );
}

function importedSubprocessBindings(
  sourceFile: ts.SourceFile,
): Map<string, SynchronousSubprocessName> {
  const bindings = new Map<string, SynchronousSubprocessName>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text !== 'node:child_process') continue;
    const namedImports = statement.importClause?.namedBindings;
    if (!namedImports || !ts.isNamedImports(namedImports)) continue;

    for (const element of namedImports.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (isSynchronousSubprocessName(importedName)) {
        bindings.set(element.name.text, importedName);
      }
    }
  }

  function collectCommonJsBindings(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      isChildProcessRequire(node.initializer)
    ) {
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const importedName = element.propertyName?.getText(sourceFile) ?? element.name.text;
        if (isSynchronousSubprocessName(importedName)) {
          bindings.set(element.name.text, importedName);
        }
      }
    }
    ts.forEachChild(node, collectCommonJsBindings);
  }

  collectCommonJsBindings(sourceFile);

  function collectInjectedBindings(node: ts.Node): void {
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer)
    ) {
      const inheritedName = bindings.get(node.initializer.text);
      if (inheritedName) bindings.set(node.name.text, inheritedName);
    }
    ts.forEachChild(node, collectInjectedBindings);
  }

  collectInjectedBindings(sourceFile);
  return bindings;
}

function subprocessName(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, SynchronousSubprocessName>,
): SynchronousSubprocessName | undefined {
  if (ts.isIdentifier(expression)) {
    return bindings.get(expression.text);
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === 'spawnSync' ||
      expression.name.text === 'execFileSync' ||
      expression.name.text === 'execSync'
      ? expression.name.text
      : undefined;
  }

  return undefined;
}

function hasHardDeadline(call: ts.CallExpression, name: SynchronousSubprocessName): boolean {
  const isBunSpawnSync =
    name === 'spawnSync' &&
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === 'Bun';
  const optionsIndex = isBunSpawnSync ? 0 : name === 'execSync' ? 1 : 2;
  const options = call.arguments[optionsIndex];
  if (!options || !ts.isObjectLiteralExpression(options)) return false;

  let hasPositiveTimeout = false;
  let hasHardKillSignal = false;
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName = ts.isIdentifier(property.name)
      ? property.name.text
      : ts.isStringLiteral(property.name)
        ? property.name.text
        : undefined;
    if (
      propertyName === 'timeout' &&
      ts.isNumericLiteral(property.initializer) &&
      Number(property.initializer.text.replaceAll('_', '')) > 0
    ) {
      hasPositiveTimeout = true;
    }
    if (
      propertyName === 'killSignal' &&
      ts.isStringLiteral(property.initializer) &&
      property.initializer.text === 'SIGKILL'
    ) {
      hasHardKillSignal = true;
    }
  }

  return hasPositiveTimeout && hasHardKillSignal;
}

export function findUnboundedSynchronousSubprocessCalls(
  source: string,
  filePath: string,
): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : filePath.endsWith('.jsx')
        ? ts.ScriptKind.JSX
        : filePath.endsWith('.ts') || filePath.endsWith('.mts') || filePath.endsWith('.cts')
          ? ts.ScriptKind.TS
          : ts.ScriptKind.JS,
  );
  const violations: string[] = [];
  const bindings = importedSubprocessBindings(sourceFile);

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const name = subprocessName(node.expression, bindings);
      if (name && !hasHardDeadline(node, name)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        violations.push(
          `${filePath}:${line} ${name} must pass a positive literal timeout and SIGKILL killSignal.`,
        );
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}
