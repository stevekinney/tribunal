import ts from 'typescript';

type SynchronousSubprocessName = 'spawnSync' | 'execFileSync' | 'execSync';

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
      if (
        importedName === 'spawnSync' ||
        importedName === 'execFileSync' ||
        importedName === 'execSync'
      ) {
        bindings.set(element.name.text, importedName);
      }
    }
  }

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

function hasTimeoutOption(call: ts.CallExpression, name: SynchronousSubprocessName): boolean {
  const isBunSpawnSync =
    name === 'spawnSync' &&
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === 'Bun';
  const optionsIndex = isBunSpawnSync ? 0 : 2;
  const options = call.arguments[optionsIndex];
  if (!options || !ts.isObjectLiteralExpression(options)) return false;

  return options.properties.some((property) => {
    if (!('name' in property) || !property.name) return false;
    return ts.isIdentifier(property.name)
      ? property.name.text === 'timeout'
      : ts.isStringLiteral(property.name) && property.name.text === 'timeout';
  });
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
      if (name && !hasTimeoutOption(node, name)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        violations.push(`${filePath}:${line} ${name} must pass an explicit timeout option.`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}
