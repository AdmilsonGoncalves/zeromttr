import path from 'node:path';
import ts from 'typescript';
import { isNonEmptyString } from '@zeromttr/utils';
import type { PatchSyntaxValidatorPort } from '../ports/index.js';

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);

interface SourceFileWithDiagnostics extends ts.SourceFile {
  parseDiagnostics?: readonly ts.Diagnostic[];
}

function getScriptKind(ext: string): ts.ScriptKind {
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

/**
 * Validates TypeScript/JavaScript/JSX patch syntax using the TypeScript Compiler API.
 */
export class TypeScriptPatchSyntaxValidator implements PatchSyntaxValidatorPort {
  public isValidSyntax(filePath: string, content: string): boolean {
    if (!isNonEmptyString(filePath) || !isNonEmptyString(content)) {
      return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    const isJs = JS_EXTENSIONS.has(ext);
    if (!isJs && !TS_EXTENSIONS.has(ext)) {
      return true;
    }

    const scriptKind = getScriptKind(ext);
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

    if (!isJs) {
      return true;
    }

    // For JS/JSX files, run Program.getSyntacticDiagnostics to catch TypeScript-only syntax
    const compilerOptions: ts.CompilerOptions = {
      allowJs: true,
      checkJs: false,
      jsx: ext === '.jsx' ? ts.JsxEmit.Preserve : ts.JsxEmit.None,
      target: ts.ScriptTarget.ES2024,
      noLib: true
    };
    const host: ts.CompilerHost = {
      getSourceFile: (name) => (name === filePath ? sourceFile : undefined),
      getDefaultLibFileName: () => 'lib.d.ts',
      writeFile: () => {},
      getCurrentDirectory: () => '',
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      fileExists: (name) => name === filePath,
      readFile: (name) => (name === filePath ? content : undefined)
    };
    const program = ts.createProgram([filePath], compilerOptions, host);
    return program.getSyntacticDiagnostics(sourceFile).length === 0;
  }
}
