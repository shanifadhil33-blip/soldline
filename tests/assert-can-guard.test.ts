import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { filesUnder, parseSource } from './helpers/source';
const mutations = new Set(['POST','PUT','PATCH','DELETE']);
const exceptions = new Map([
  ['src/app/api/auth/[...nextauth]/route.ts', 'Auth.js owns OAuth validation'],
  ['src/app/api/demo/start/route.ts', 'public demo creation has no member yet'],
  ['src/app/api/sign-out/route.ts', 'signing out needs no permission, only a same site POST'],
  ['src/server/sign-out.ts', 'signing out needs no permission, only a same site POST'],
]);
function guarded(text: string, file: string): boolean {
  const source = parseSource(text, file);
  const imports = new Map<string, string>();
  for (const node of source.statements) if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
    for (const item of node.importClause.namedBindings.elements) {
      const name = item.propertyName?.text ?? item.name.text;
      if ((name === 'withMemberRoute' && /(?:server\/|\.\/)http$/.test(node.moduleSpecifier.text)) || (name === 'assertCan' && /(?:server\/|\.\/)permissions$/.test(node.moduleSpecifier.text)) || (name === 'withSystemRoute' && /server\/events\/http$/.test(node.moduleSpecifier.text))) imports.set(item.name.text, name);
    }
  }
  let hasMutation = false;
  const guardedExports: boolean[] = [];
  const exported = (node: ts.Node) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const calls = (node: ts.Node, guard: string): boolean => {
    let found = false;
    function visit(child: ts.Node) {
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && imports.get(child.expression.text) === guard) found = true;
      ts.forEachChild(child, visit);
    }
    visit(node); return found;
  };
  const serverFile = source.statements.some(node => ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'use server');
  for (const node of source.statements) {
    if (ts.isExportAssignment(node) && serverFile) { hasMutation = true; guardedExports.push(calls(node.expression, 'assertCan')); }
    if (ts.isExportDeclaration(node)) {
      // A mutation reexport must have an explicit registry exception.
      if (serverFile || !node.exportClause || (ts.isNamedExports(node.exportClause) && node.exportClause.elements.some(item => mutations.has(item.name.text)))) { hasMutation = true; guardedExports.push(false); }
    }
    if (!exported(node)) continue;
    if (ts.isFunctionDeclaration(node) && (serverFile || (node.name && mutations.has(node.name.text)))) { hasMutation = true; guardedExports.push(calls(node, 'assertCan')); }
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
      const names = ts.isIdentifier(declaration.name) ? [declaration.name.text] : declaration.name.elements.flatMap(item => ts.isBindingElement(item) ? [item.name.getText(source)] : []);
      if (!serverFile && !names.some(name => mutations.has(name))) continue;
      hasMutation = true;
      guardedExports.push(!!declaration.initializer && ((ts.isCallExpression(declaration.initializer) && ts.isIdentifier(declaration.initializer.expression) && (imports.get(declaration.initializer.expression.text) === 'withMemberRoute' || (imports.get(declaration.initializer.expression.text) === 'withSystemRoute' && declaration.initializer.arguments.length===1 && ts.isStringLiteral(declaration.initializer.arguments[0]) && ['hubspot','clickup','tick','daily'].includes(declaration.initializer.arguments[0].text)))) || calls(declaration.initializer, 'assertCan')));
    }
  }
  // Inline server actions are checked independently of the surrounding page export.
  function visit(node: ts.Node) {
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) && node.body && ts.isBlock(node.body) && node.body.statements.some(s => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === 'use server')) { hasMutation = true; guardedExports.push(calls(node, 'assertCan')); }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return !hasMutation || guardedExports.every(Boolean);
}
it('Requires permission guards on every API mutation and server action', () => {
  for (const file of filesUnder('src').filter(file => /\.tsx?$/.test(file))) {
    const text = readFileSync(file, 'utf8');
    if (exceptions.has(file)) { expect(text, file).toContain(`Permission guard exception: ${exceptions.get(file)}`); continue; }
    expect(guarded(text, file), file).toBe(true);
  }
});
it('Detects forgotten guards, unused imports, unrelated calls, reexports and partially guarded routes', () => {
  for (const source of [
    'export async function POST() { return write(); }',
    'import {assertCan} from "../../server/permissions"; export async function POST() { return write(); }',
    'import {withMemberRoute} from "./fake"; export const POST = withMemberRoute(write);',
    'export { POST } from "./unprotected";',
    'import {withMemberRoute} from "../../server/http"; export const POST=withMemberRoute(write); export async function DELETE(){ return write(); }',
    'export default function Page(){ return <form action={async () => { "use server"; await write(); }} />; }',
    '"use server"; export async function update() { return write(); }',
    '"use server"; export default async function () { return write(); }',
    '"use server"; export default async () => write();',
    'export * from "./unprotected";',
    'import {withSystemRoute} from "../../server/events/http"; export const POST=withSystemRoute(write);',
    'import {withSystemRoute} from "../../server/events/http"; export const POST=withSystemRoute("unknown");',
    'import {withSystemRoute} from "./fake"; export const POST=withSystemRoute("tick");',
  ]) expect(guarded(source, 'sample.tsx')).toBe(false);
  expect(guarded('import {withMemberRoute as wrap} from "../../server/http"; export const POST=wrap(write);', 'sample.ts')).toBe(true);
});
