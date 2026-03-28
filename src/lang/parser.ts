import {
  rule,
  alt_sc,
  apply,
  seq,
  tok,
  kmid,
  kright,
  kleft,
  lrec_sc,
  list_sc,
  opt_sc,
  rep_sc,
  expectEOF,
  expectSingleResult,
  str,
} from 'typescript-parsec'
import { Token, lexer } from '@/lang/lexer'
import type {
  Expression,
  Program,
  ParameterStmt,
  ParamBounds,
} from '@/lang/ast'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Skip zero or more newlines */
const _ = rep_sc(tok(Token.Newline))

/** One or more newlines or semicolons (statement separator) */
const sep = rep_sc(alt_sc(tok(Token.Newline), tok(Token.Semicolon)))

// ---------------------------------------------------------------------------
// Forward-declared rules
// ---------------------------------------------------------------------------

const expr = rule<Token, Expression>()
const stmt = rule<Token, Expression>()

// ---------------------------------------------------------------------------
// Primary expressions
// ---------------------------------------------------------------------------

const numberLit = apply(
  tok(Token.Number),
  (t): Expression => ({ type: 'Literal', value: parseFloat(t.text) }),
)

/** Comma-separated argument list (zero or more), tolerant of newlines */
const argList = apply(
  opt_sc(
    list_sc(
      kright(_, expr),
      kright(tok(Token.Comma), _),
    ),
  ),
  (r) => r ?? [],
)

/** Parenthesized argument list: ( args ) */
const parenArgs = kmid(
  tok(Token.LParen),
  argList,
  seq(_, tok(Token.RParen)),
)

/** (params) => body */
const parenLambda = apply(
  seq(
    kmid(
      tok(Token.LParen),
      opt_sc(list_sc(kright(_, tok(Token.Ident)), kright(tok(Token.Comma), _))),
      seq(_, tok(Token.RParen)),
    ),
    kright(tok(Token.Arrow), expr),
  ),
  ([params, body]): Expression => ({
    type: 'Lambda',
    params: (params ?? []).map((t) => t.text),
    body,
  }),
)

/** ident => body  OR  just ident (variable) */
const identExpr = alt_sc(
  // ident => body (lambda with single param)
  apply(
    seq(tok(Token.Ident), kright(tok(Token.Arrow), expr)),
    ([param, body]): Expression => ({
      type: 'Lambda',
      params: [param.text],
      body,
    }),
  ),
  // plain variable
  apply(tok(Token.Ident), (t): Expression => ({ type: 'Variable', name: t.text })),
)

/** Parenthesized expression: ( expr ) */
const parenExpr = kmid(
  tok(Token.LParen),
  kright(_, expr),
  seq(_, tok(Token.RParen)),
)

/** Block: { stmt; stmt; ... } */
const block = apply(
  kmid(
    seq(tok(Token.LBrace), _),
    opt_sc(list_sc(stmt, sep)),
    seq(_, tok(Token.RBrace)),
  ),
  (stmts): Expression => ({
    type: 'Block',
    statements: stmts ?? [],
  }),
)

/** operation name(params) { body } */
const fnDefn = apply(
  seq(
    kright(tok(Token.Operation), tok(Token.Ident)),
    kmid(
      tok(Token.LParen),
      opt_sc(list_sc(kright(_, tok(Token.Ident)), kright(tok(Token.Comma), _))),
      seq(_, tok(Token.RParen)),
    ),
    kmid(
      seq(tok(Token.LBrace), _),
      opt_sc(list_sc(stmt, sep)),
      seq(_, tok(Token.RBrace)),
    ),
  ),
  ([name, params, body]): Expression => ({
    type: 'FnDefn',
    name: name.text,
    params: (params ?? []).map((t) => t.text),
    body: body ?? [],
  }),
)

const primary = alt_sc(
  numberLit,
  parenLambda,
  fnDefn,
  block,
  identExpr,
  parenExpr,
)

// ---------------------------------------------------------------------------
// Postfix: property access and function application
// ---------------------------------------------------------------------------

type PostfixSuffix =
  | { kind: 'prop'; name: string }
  | { kind: 'call'; args: Expression[] }

const postfixSuffix = alt_sc(
  apply(
    kright(tok(Token.Dot), tok(Token.Ident)),
    (t): PostfixSuffix => ({ kind: 'prop', name: t.text }),
  ),
  apply(parenArgs, (args): PostfixSuffix => ({ kind: 'call', args })),
)

const postfix = lrec_sc(primary, postfixSuffix, (lhs, suffix): Expression => {
  if (suffix.kind === 'prop') {
    return { type: 'PropertyAccess', object: lhs, property: suffix.name }
  }
  return { type: 'Apply', callee: lhs, args: suffix.args }
})

// ---------------------------------------------------------------------------
// Unary: -x, +x
// ---------------------------------------------------------------------------

const unary: typeof expr = rule<Token, Expression>()
unary.setPattern(
  alt_sc(
    apply(
      seq(alt_sc(tok(Token.Minus), tok(Token.Plus)), unary),
      ([op, arg]): Expression => ({
        type: 'UnaryOp',
        op: op.text,
        argument: arg,
      }),
    ),
    postfix,
  ),
)

// ---------------------------------------------------------------------------
// Binary operators (ascending precedence via nested lrec_sc)
// ---------------------------------------------------------------------------

function binop(
  operand: typeof expr,
  ...ops: Token[]
): typeof expr {
  const r = rule<Token, Expression>()
  let opParser = tok<Token>(ops[0])
  for (let i = 1; i < ops.length; i++) {
    opParser = alt_sc(opParser, tok<Token>(ops[i])) as typeof opParser
  }
  r.setPattern(
    lrec_sc(operand, seq(opParser, operand), (lhs, [op, rhs]): Expression => ({
      type: 'BinOp',
      op: op.text,
      lhs,
      rhs,
    })),
  )
  return r
}

const power = binop(unary, Token.StarStar)
const multiplicative = binop(power, Token.Star, Token.Slash, Token.Percent)
const additive = binop(multiplicative, Token.Plus, Token.Minus)

// `and` and `or` use identifier tokens — match by text
function binopByText(
  operand: typeof expr,
  text: string,
): typeof expr {
  const r = rule<Token, Expression>()
  r.setPattern(
    lrec_sc(operand, seq(str(text), operand), (lhs, [op, rhs]): Expression => ({
      type: 'BinOp',
      op: op.text,
      lhs,
      rhs,
    })),
  )
  return r
}

const andExpr = binopByText(additive, 'and')
const orExpr = binopByText(andExpr, 'or')

// ---------------------------------------------------------------------------
// Expression & Statement
// ---------------------------------------------------------------------------

expr.setPattern(orExpr)

stmt.setPattern(
  alt_sc(
    // assignment: ident = expr
    apply(
      seq(tok(Token.Ident), kright(tok(Token.Eq), expr)),
      ([target, expression]): Expression => ({
        type: 'Assignment',
        target: target.text,
        expression,
      }),
    ),
    // bare expression
    expr,
  ),
)

// ---------------------------------------------------------------------------
// Parameter block
// ---------------------------------------------------------------------------

const paramBounds = alt_sc(
  // min < mid < max
  apply(
    seq(
      tok(Token.Number),
      kright(tok(Token.Lt), tok(Token.Number)),
      kright(tok(Token.Lt), tok(Token.Number)),
    ),
    ([min, mid, max]): ParamBounds => ({
      min: parseFloat(min.text),
      mid: parseFloat(mid.text),
      max: parseFloat(max.text),
    }),
  ),
  // bare value (min = max = mid)
  apply(tok(Token.Number), (t): ParamBounds => {
    const v = parseFloat(t.text)
    return { min: v, mid: v, max: v }
  }),
)

const paramEntry = apply(
  seq(tok(Token.Ident), kright(tok(Token.Colon), paramBounds)),
  ([name, bounds]) => ({ name: name.text, bounds }),
)

const parameterBlock = apply(
  kmid(
    seq(tok(Token.Parameters), tok(Token.LBrace), _),
    rep_sc(kleft(paramEntry, _)),
    tok(Token.RBrace),
  ),
  (parameters): ParameterStmt => ({ type: 'ParameterStmt', parameters }),
)

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = apply(
  seq(
    _,
    opt_sc(kleft(parameterBlock, _)),
    opt_sc(list_sc(stmt, sep)),
    _,
  ),
  ([, parameters, statements]): Program => ({
    parameters: parameters ?? null,
    statements: statements ?? [],
  }),
)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parse(input: string): Program {
  return expectSingleResult(expectEOF(program.parse(lexer.parse(input))))
}

export function parseExpression(input: string): Expression {
  return expectSingleResult(expectEOF(expr.parse(lexer.parse(input))))
}
