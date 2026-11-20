import path from 'node:path';
import ts from 'typescript';
import { isNonEmptyString } from '@zeromttr/utils';
import type { PatchSyntaxValidatorPort } from '../ports/reasoning.port.js';

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const JS_EARLY_ERROR_CODES = new Set([
  1100, // Invalid use of 'eval' or 'arguments' in strict mode
  1155, // 'const' declarations must be initialized
  1212, // Identifier expected. Strict-mode reserved word
  1359, // Identifier expected. Reserved word
  2323, // Cannot redeclare exported variable
  2451, // Cannot redeclare block-scoped variable
  2484, // Export declaration conflicts with exported declaration
  2528 // A module cannot have multiple default exports
]);

interface TextRangeWithOffsets {
  pos: number;
  end: number;
}

interface SourceFileWithDiagnostics extends ts.SourceFile {
  parseDiagnostics?: readonly ts.Diagnostic[];
  checkJsDirective?: { enabled?: boolean; pos: number; end: number };
  commentDirectives?: readonly { range: TextRangeWithOffsets }[];
  pragmas?: Map<
    string,
    { range: TextRangeWithOffsets } | readonly { range: TextRangeWithOffsets }[]
  >;
}

const SUPPRESSION_DIRECTIVE_PATTERN = /@ts-(?:ignore|expect-error|nocheck)/gi;

/**
 * Validates TypeScript/JavaScript/JSX patch syntax using the TypeScript Compiler API.
 */
export class TypeScriptPatchSyntaxValidator implements PatchSyntaxValidatorPort {
  /**
   * Checks whether proposed TS/JS/JSX patch content parses without syntax or early JS errors.
   */
  public isValidSyntax(filePath: string, content: string): boolean {
    if (!isNonEmptyString(filePath) || !isNonEmptyString(content)) {
      return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    const isJs = JS_EXTENSIONS.has(ext);
    if (!isJs && !TS_EXTENSIONS.has(ext)) {
      return true;
    }

    const scriptKind = this.getScriptKind(ext);
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.ES2024,
      true,
      scriptKind
    ) as SourceFileWithDiagnostics;

    if (sourceFile.parseDiagnostics && sourceFile.parseDiagnostics.length > 0) {
      return false;
    }

    // Reject empty or comment-only TS/JS patches (e.g. degraded comment-only fallback text)
    if (sourceFile.statements.length === 0) {
      return false;
    }

    if (!isJs) {
      return true;
    }

    // For JS/JSX files, run Program diagnostics on a directive-stripped validation view
    // to catch TypeScript-only syntax and JS early errors without mutating the original patch.
    const validationContent = this.stripDiagnosticSuppressionDirectives(sourceFile, content);
    const validationSourceFile =
      validationContent === content
        ? sourceFile
        : (ts.createSourceFile(
            filePath,
            validationContent,
            ts.ScriptTarget.ES2024,
            true,
            scriptKind
          ) as SourceFileWithDiagnostics);

    const compilerOptions: ts.CompilerOptions = {
      allowJs: true,
      checkJs: true,
      jsx: ext === '.jsx' ? ts.JsxEmit.Preserve : ts.JsxEmit.None,
      target: ts.ScriptTarget.ES2024,
      noLib: true
    };
    const host: ts.CompilerHost = {
      getSourceFile: (name) => (name === filePath ? validationSourceFile : undefined),
      getDefaultLibFileName: () => 'lib.d.ts',
      writeFile: () => {},
      getCurrentDirectory: () => '',
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      fileExists: (name) => name === filePath,
      readFile: (name) => (name === filePath ? validationContent : undefined)
    };
    const program = ts.createProgram([filePath], compilerOptions, host);
    if (program.getSyntacticDiagnostics(validationSourceFile).length > 0) {
      return false;
    }

    const earlyErrors = program
      .getSemanticDiagnostics(validationSourceFile)
      .filter((diag) => JS_EARLY_ERROR_CODES.has(diag.code));
    return earlyErrors.length === 0;
  }

  /**
   * Neutralizes `@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck` directives within TypeScript-parsed
   * comment ranges of a validation-only copy so semantic checks cannot be suppressed in JS patches,
   * while preserving block-comment delimiters, line structure, and the original patch text.
   */
  private stripDiagnosticSuppressionDirectives(
    sourceFile: SourceFileWithDiagnostics,
    content: string
  ): string {
    const ranges = this.collectSuppressionRanges(sourceFile);
    if (ranges.length === 0) {
      return content;
    }

    const chars = content.split('');
    for (const range of ranges) {
      const start = Math.max(0, range.pos);
      const end = Math.min(chars.length, range.end);
      const slice = content.slice(start, end);
      const neutralized = slice.replace(SUPPRESSION_DIRECTIVE_PATTERN, (match) =>
        ' '.repeat(match.length)
      );
      for (let i = 0; i < neutralized.length; i++) {
        chars[start + i] = neutralized[i];
      }
    }

    return chars.join('');
  }

  private collectSuppressionRanges(sourceFile: SourceFileWithDiagnostics): TextRangeWithOffsets[] {
    const ranges: TextRangeWithOffsets[] = [];

    if (sourceFile.checkJsDirective && sourceFile.checkJsDirective.enabled === false) {
      ranges.push({ pos: sourceFile.checkJsDirective.pos, end: sourceFile.checkJsDirective.end });
    }

    if (sourceFile.commentDirectives) {
      for (const directive of sourceFile.commentDirectives) {
        ranges.push(directive.range);
      }
    }

    const nocheckPragmas = sourceFile.pragmas?.get('ts-nocheck');
    if (nocheckPragmas) {
      const entries = Array.isArray(nocheckPragmas) ? nocheckPragmas : [nocheckPragmas];
      for (const entry of entries) {
        ranges.push(entry.range);
      }
    }

    return ranges;
  }

  private getScriptKind(ext: string): ts.ScriptKind {
    if (ext === '.tsx') {
      return ts.ScriptKind.TSX;
    }
    if (ext === '.jsx') {
      return ts.ScriptKind.JSX;
    }
    if (JS_EXTENSIONS.has(ext)) {
      return ts.ScriptKind.JS;
    }
    return ts.ScriptKind.TS;
  }
}
