/**
 * Parse JSON that may contain comments.
 *
 * `turbo.json` and `tsconfig.json` both permit `//` and block comments, which
 * `JSON.parse` and `Bun.file().json()` reject. Stripping them with a plain
 * regex corrupts any string containing `//` — notably the `$schema` URL that
 * sits at the top of every `turbo.json` — so this walks the text and tracks
 * whether it is inside a string literal.
 */
export function stripJsonComments(text: string): string {
  let result = '';
  let index = 0;
  let insideString = false;

  while (index < text.length) {
    const character = text[index];

    if (insideString) {
      result += character;

      if (character === '\\') {
        result += text[index + 1] ?? '';
        index += 2;
        continue;
      }

      if (character === '"') {
        insideString = false;
      }

      index += 1;
      continue;
    }

    if (character === '"') {
      insideString = true;
      result += character;
      index += 1;
      continue;
    }

    if (character === '/' && text[index + 1] === '/') {
      const lineEnd = text.indexOf('\n', index);
      if (lineEnd === -1) break;

      index = lineEnd;
      continue;
    }

    if (character === '/' && text[index + 1] === '*') {
      const commentEnd = text.indexOf('*/', index + 2);
      index = commentEnd === -1 ? text.length : commentEnd + 2;
      continue;
    }

    result += character;
    index += 1;
  }

  return result;
}

/** Parse JSONC text into a value, preserving comment-free JSON semantics. */
export function parseJsonC<T>(text: string): T {
  return JSON.parse(stripJsonComments(text)) as T;
}
