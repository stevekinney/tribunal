import ts from 'typescript';

type SynchronousSubprocessName = 'spawnSync' | 'execFileSync' | 'execSync';

function isSynchronousSubprocessName(value: string): value is SynchronousSubprocessName {
  return value === 'spawnSync' || value === 'execFileSync' || value === 'execSync';
}

function isChildProcessModuleSpecifier(value: string): boolean {
  return value === 'node:child_process' || value === 'child_process';
}

function isChildProcessRequire(expression: ts.Expression | undefined): boolean {
  return Boolean(
    expression &&
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'require' &&
    expression.arguments.length === 1 &&
    ts.isStringLiteral(expression.arguments[0]) &&
    isChildProcessModuleSpecifier(expression.arguments[0].text),
  );
}

function importedSubprocessBindings(sourceFile: ts.SourceFile): {
  bindings: Map<string, SynchronousSubprocessName>;
  namespaces: Set<string>;
} {
  const bindings = new Map<string, SynchronousSubprocessName>();
  const namespaces = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!isChildProcessModuleSpecifier(statement.moduleSpecifier.text)) continue;
    const namedImports = statement.importClause?.namedBindings;
    if (!namedImports) continue;

    if (ts.isNamespaceImport(namedImports)) {
      namespaces.add(namedImports.name.text);
      continue;
    }

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
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isChildProcessRequire(node.initializer)
    ) {
      namespaces.add(node.name.text);
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
    if (ts.isParameter(node) && ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name) || !element.initializer) continue;
        if (!ts.isIdentifier(element.initializer)) continue;
        const inheritedName = bindings.get(element.initializer.text);
        if (inheritedName) bindings.set(element.name.text, inheritedName);
      }
    }
    ts.forEachChild(node, collectInjectedBindings);
  }

  collectInjectedBindings(sourceFile);
  return { bindings, namespaces };
}

function subprocessName(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, SynchronousSubprocessName>,
  namespaces: ReadonlySet<string>,
): SynchronousSubprocessName | undefined {
  if (ts.isIdentifier(expression)) {
    return bindings.get(expression.text);
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const name = expression.name.text;
    if (!isSynchronousSubprocessName(name) || !ts.isIdentifier(expression.expression)) {
      return undefined;
    }
    const receiver = expression.expression.text;
    return (receiver === 'Bun' && name === 'spawnSync') || namespaces.has(receiver)
      ? name
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
  const secondArgumentIsOptions =
    call.arguments[1] && ts.isObjectLiteralExpression(call.arguments[1]);
  const optionsIndex = isBunSpawnSync ? 0 : name === 'execSync' || secondArgumentIsOptions ? 1 : 2;
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
  const { bindings, namespaces } = importedSubprocessBindings(sourceFile);

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const name = subprocessName(node.expression, bindings, namespaces);
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
