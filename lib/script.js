'use strict'

/**
 * The player's language.
 *
 * The whole script is re-read top to bottom on every tick. That single decision
 * is what removes the hard parts: there is no program counter to advance, no
 * coroutines to schedule, no event queue to drain. A rule sheet is consulted,
 * the true branches run, and the tick ends. Nothing survives to the next tick
 * except the game state itself.
 *
 * It also buys a safety property worth stating plainly: the language has no
 * loops and no recursion, so a script cannot hang the game. That is what makes
 * it safe to run a stranger's script every frame, which is what lets strategies
 * travel between players.
 *
 * Shape, learned from StoneScript:
 *
 *   ?hp < 7
 *    use potion
 *   :?foe.dist > 5
 *    equip crossbow
 *   :
 *    equip sword
 *
 * Indentation is the dependency. A line runs only if the condition it sits
 * under was true. There is no `end`, no braces, nothing to close.
 */

const MAX_LINES = 400
const MAX_DEPTH = 12

/** Comparison operators, longest first so `>=` is not read as `>`. */
const COMPARISONS = ['>=', '<=', '!=', '=', '>', '<']

class ScriptError extends Error {
  constructor(message, line) {
    super(message)
    this.name = 'ScriptError'
    this.line = line
  }
}

/**
 * Count leading spaces. Tabs are rejected rather than guessed at: a tab that
 * renders as 4 in one editor and 8 in another silently changes which branch a
 * line belongs to, and the player would have no way to see it.
 * @param {string} raw
 * @param {number} lineNo
 * @returns {number}
 */
function indentOf(raw, lineNo) {
  let n = 0
  while (n < raw.length && raw[n] === ' ') n++
  if (raw[n] === '\t') {
    throw new ScriptError('use spaces, not tabs, for indentation', lineNo)
  }
  return n
}

/**
 * Parse the source into a tree of nodes by indentation.
 *
 * Each node is `{ kind, test, cmd, args, line, children }` where kind is one of
 * 'if' | 'elif' | 'else' | 'cmd'.
 *
 * @param {string} source
 * @returns {{ nodes: object[], errors: ScriptError[] }}
 */
function parse(source) {
  const errors = []
  const root = { kind: 'root', children: [], indent: -1 }
  const stack = [root]

  const lines = String(source ?? '').split('\n')
  if (lines.length > MAX_LINES) {
    errors.push(new ScriptError(`script is longer than ${MAX_LINES} lines`, MAX_LINES))
    lines.length = MAX_LINES
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineNo = i + 1

    const hash = raw.indexOf('//')
    const stripped = hash === -1 ? raw : raw.slice(0, hash)
    if (stripped.trim() === '') continue

    let indent
    try {
      indent = indentOf(stripped, lineNo)
    } catch (err) {
      errors.push(err)
      continue
    }
    if (indent / 1 > MAX_DEPTH) {
      errors.push(new ScriptError('nested too deep', lineNo))
      continue
    }

    // Pop back to the level this line belongs to. Deeper-than-parent means it
    // is a child of whatever opened last.
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }

    const text = stripped.trim()
    const parent = stack[stack.length - 1]
    let node

    if (text.startsWith(':?')) {
      node = { kind: 'elif', test: text.slice(2).trim(), line: lineNo, indent, children: [] }
    } else if (text === ':') {
      node = { kind: 'else', line: lineNo, indent, children: [] }
    } else if (text.startsWith('?')) {
      node = { kind: 'if', test: text.slice(1).trim(), line: lineNo, indent, children: [] }
    } else if (text.startsWith('>')) {
      node = { kind: 'say', args: text.slice(1).trim(), line: lineNo, indent, children: [] }
    } else {
      const parts = text.split(/\s+/)
      node = {
        kind: 'cmd',
        cmd: parts[0].toLowerCase(),
        args: parts.slice(1),
        line: lineNo,
        indent,
        children: []
      }
    }

    // `:` and `:?` must follow a branch at the same level, or the player wrote
    // an else with nothing to be an else of. Saying so beats silently ignoring.
    if (node.kind === 'elif' || node.kind === 'else') {
      const prev = parent.children[parent.children.length - 1]
      if (!prev || (prev.kind !== 'if' && prev.kind !== 'elif')) {
        errors.push(new ScriptError('this needs a ? above it at the same indent', lineNo))
        continue
      }
    }

    parent.children.push(node)
    stack.push(node)
  }

  return { nodes: root.children, errors }
}

/**
 * Read a dotted path out of the world, e.g. `foe.dist`.
 * Unknown names read as undefined rather than throwing, so one typo does not
 * take the whole script down mid-fight; the condition simply fails.
 * @param {object} world
 * @param {string} path
 * @returns {any}
 */
function lookup(world, path) {
  let cur = world
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[part]
  }
  return cur
}

/**
 * Resolve one operand: a number literal, a quoted string, or a world path.
 * @param {object} world
 * @param {string} token
 * @returns {any}
 */
function operand(world, token) {
  const t = token.trim()
  if (t === '') return undefined
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true'
  return lookup(world, t)
}

/**
 * Evaluate a single comparison, or a bare truthiness test.
 *
 * A bare name is true when it exists and is not zero or empty, which is what
 * lets `?foe` read as "there is an enemy" without the player learning about
 * null. The value returned by the world decides; the language stays out of it.
 *
 * @param {object} world
 * @param {string} expr
 * @returns {boolean}
 */
function compare(world, expr) {
  for (const op of COMPARISONS) {
    const at = expr.indexOf(op)
    if (at === -1) continue
    // `>=` contains `>`; the longest-first order of COMPARISONS handles that,
    // but `!=` also contains `=`, so check we are not splitting mid-operator.
    if (op === '=' && (expr[at - 1] === '!' || expr[at - 1] === '>' || expr[at - 1] === '<')) continue

    const left = operand(world, expr.slice(0, at))
    const right = operand(world, expr.slice(at + op.length))

    switch (op) {
      case '>=': return Number(left) >= Number(right)
      case '<=': return Number(left) <= Number(right)
      case '!=': return left !== right
      case '=': return left === right || String(left) === String(right)
      case '>': return Number(left) > Number(right)
      case '<': return Number(left) < Number(right)
    }
  }

  const v = operand(world, expr)
  return v !== undefined && v !== null && v !== false && v !== 0 && v !== ''
}

/**
 * Evaluate a condition with `&`, `|` and a leading `!`.
 *
 * `&` binds tighter than `|`, which is the ordering people expect from
 * arithmetic without being told. There are no parentheses on purpose: they are
 * the first thing that makes a rule sheet look like a program.
 *
 * @param {object} world
 * @param {string} expr
 * @returns {boolean}
 */
function evaluate(world, expr) {
  const ors = expr.split('|')
  for (const orPart of ors) {
    const ands = orPart.split('&')
    let all = true
    for (const andPart of ands) {
      let t = andPart.trim()
      let negate = false
      while (t.startsWith('!')) {
        negate = !negate
        t = t.slice(1).trim()
      }
      const v = compare(world, t)
      if ((negate ? !v : v) === false) {
        all = false
        break
      }
    }
    if (all) return true
  }
  return false
}

/**
 * Run one tick of the script.
 *
 * Commands are collected rather than applied. Later commands overwrite earlier
 * ones of the same kind, which is what makes a rule sheet behave the way a
 * player reads it: the last rule that matched wins. Applying them as they are
 * found would let an early rule spend the tick before a later, more specific
 * rule got a chance to speak.
 *
 * @param {object[]} nodes - from parse()
 * @param {object} world - the readable game state
 * @returns {{ actions: object[], says: string[] }}
 */
function run(nodes, world) {
  const actions = []
  const says = []

  const walk = (list) => {
    let lastBranchTaken = false

    for (const node of list) {
      switch (node.kind) {
        case 'if':
          lastBranchTaken = evaluate(world, node.test)
          if (lastBranchTaken) walk(node.children)
          break

        case 'elif':
          if (lastBranchTaken) break
          lastBranchTaken = evaluate(world, node.test)
          if (lastBranchTaken) walk(node.children)
          break

        case 'else':
          if (lastBranchTaken) break
          lastBranchTaken = true
          walk(node.children)
          break

        case 'say':
          says.push(interpolate(world, node.args))
          break

        case 'cmd':
          actions.push({ cmd: node.cmd, args: node.args, line: node.line })
          break
      }
    }
  }

  walk(nodes)
  return { actions, says }
}

/**
 * Replace `@path@` with the live value, so a player can watch the number that
 * their own condition is reading. Printing the state you branch on is how you
 * debug a rule sheet, and it has to be one character to type.
 * @param {object} world
 * @param {string} text
 * @returns {string}
 */
function interpolate(world, text) {
  return String(text).replace(/@([^@]+)@/g, (_, path) => {
    const v = lookup(world, path.trim())
    return v === undefined ? '?' : String(v)
  })
}

module.exports = { parse, run, evaluate, interpolate, ScriptError, MAX_LINES }
