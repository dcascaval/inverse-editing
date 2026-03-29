export interface ParamBounds {
  min: number
  mid: number
  max: number
}

export interface ParameterStmt {
  type: 'ParameterStmt'
  parameters: Array<{ name: string; bounds: ParamBounds }>
}

export interface Variable {
  type: 'Variable'
  name: string
}

export interface Literal {
  type: 'Literal'
  value: number
}

export interface BinOp {
  type: 'BinOp'
  op: string
  lhs: Expression
  rhs: Expression
}

export interface UnaryOp {
  type: 'UnaryOp'
  op: string
  argument: Expression
}

export interface Assignment {
  type: 'Assignment'
  target: string
  expression: Expression
}

export interface Apply {
  type: 'Apply'
  callee: Expression
  args: Expression[]
}

export interface PropertyAccess {
  type: 'PropertyAccess'
  object: Expression
  property: string
}

export interface Lambda {
  type: 'Lambda'
  params: string[]
  body: Expression
}

export interface Block {
  type: 'Block'
  statements: Expression[]
}

export interface FnDefn {
  type: 'FnDefn'
  name: string
  params: string[]
  body: Expression[]
}

export type Expression =
  | Variable
  | Literal
  | BinOp
  | UnaryOp
  | Assignment
  | Apply
  | PropertyAccess
  | Lambda
  | Block
  | FnDefn

export type AST = ParameterStmt | Expression

export interface Program {
  parameters: ParameterStmt;
  statements: Expression[]
}

export function show(node: AST): string {
  switch (node.type) {
    case 'ParameterStmt':
      return node.parameters
        .map((p) => `${p.name}: ${p.bounds.mid.toFixed(2)}`)
        .join(', ')
    case 'Variable':
      return node.name
    case 'Literal':
      return node.value.toFixed(2)
    case 'BinOp':
      return `(${show(node.lhs)} ${node.op} ${show(node.rhs)})`
    case 'UnaryOp':
      return `(${node.op}${show(node.argument)})`
    case 'Assignment':
      return `${node.target} = ${show(node.expression)}`
    case 'Apply':
      return `${show(node.callee)}(${node.args.map(show).join(', ')})`
    case 'PropertyAccess':
      return `${show(node.object)}.${node.property}`
    case 'Lambda':
      return `(${node.params.join(', ')}) => ${show(node.body)}`
    case 'Block':
      return `{${node.statements.map(show).join('; ')}}`
    case 'FnDefn':
      return `operation ${node.name}(${node.params.join(', ')}) {${node.body.map(show).join('; ')}}`
  }
}

export function showProgram(prog: Program): string {
  const parts: string[] = []
  if (prog.parameters) parts.push(`parameters {${show(prog.parameters)}}`)
  parts.push(...prog.statements.map(show))
  return parts.join('\n')
}
