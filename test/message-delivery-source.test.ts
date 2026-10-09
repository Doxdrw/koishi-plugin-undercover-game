import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, it } from "node:test"
import ts from "typescript"

const DELIVERY_METHODS = new Set(["state", "bestEffort", "required"])
const RAW_SEND_METHODS = new Set(["sendMessage", "sendPrivateMessage"])

interface DeliveryViolation {
  readonly file: string
  readonly line: number
  readonly text: string
}

function rawSendMethod(node: ts.CallExpression, source: ts.SourceFile): string | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return
  const method = node.expression.name.text
  if (RAW_SEND_METHODS.has(method)) return method
  if (method !== "send") return
  const receiver = node.expression.expression.getText(source)
  if (receiver === "session" || receiver.endsWith(".session")) return method
}

function isDeliveryWrapper(node: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText().endsWith("messages")
    && DELIVERY_METHODS.has(node.expression.name.text)
}

function isHandledSend(call: ts.CallExpression): boolean {
  let current: ts.Node = call
  while (current.parent) {
    const parent = current.parent
    if (ts.isAwaitExpression(parent) || ts.isReturnStatement(parent)) return true
    if (ts.isCallExpression(parent)
      && ts.isPropertyAccessExpression(parent.expression)
      && parent.expression.name.text === "catch") return true
    if (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) {
      const wrapper = parent.parent
      return ts.isCallExpression(wrapper)
        && wrapper.arguments.includes(parent)
        && isDeliveryWrapper(wrapper)
    }
    if (ts.isExpressionStatement(parent) || ts.isVariableDeclaration(parent)) return false
    current = parent
  }
  return false
}

function inspectSource(file: string, sourceText: string): DeliveryViolation[] {
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const violations: DeliveryViolation[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && rawSendMethod(node, source) && !isHandledSend(node)) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source))
      violations.push({
        file,
        line: position.line + 1,
        text: node.getText(source).replace(/\s+/g, " ").slice(0, 160),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return violations
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : []
  }))
  return nested.flat()
}

describe("message delivery source gate", () => {
  it("rejects floating and bare void message promises", () => {
    assert.equal(inspectSource("floating.ts", "session.bot.sendMessage('g', 'x')").length, 1)
    assert.equal(inspectSource("void.ts", "void session.bot.sendPrivateMessage('u', 'x')").length, 1)
  })

  it("accepts awaited, returned, caught, and delivery-layer sends", () => {
    const sample = `
      async function awaited() { await session.send('x') }
      function returned() { return session.bot.sendMessage('g', 'x') }
      function caught() { void session.bot.sendPrivateMessage('u', 'x').catch(report) }
      function wrapped() { messages.bestEffort('label', () => session.bot.sendMessage('g', 'x')) }
    `
    assert.deepEqual(inspectSource("safe.ts", sample), [])
  })

  it("keeps every production message promise behind an explicit boundary", async () => {
    const files = await sourceFiles(resolve("src"))
    const violations: DeliveryViolation[] = []
    for (const file of files) {
      violations.push(...inspectSource(file, await readFile(file, "utf8")))
    }
    assert.deepEqual(violations, [], violations.map(item =>
      `${item.file}:${item.line} ${item.text}`,
    ).join("\n"))
  })
})
