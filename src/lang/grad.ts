/**
 * DualValue — tape-backed NumericValue for reverse-mode AD.
 *
 * Each instance points to a node on a shared Tape. Arithmetic methods
 * compute the primal, record the operation on the tape, and return a new
 * DualValue for the result node.
 *
 * After program evaluation, the tape can be extended (e.g. to compute a
 * distance-to-target loss) and then backward() gives gradients of that
 * extended expression w.r.t. all upstream nodes — without re-evaluating
 * the original program.
 */

import type { NumericValue } from '@/lang/numeric'

export class DualValue implements NumericValue<DualValue> {
  constructor(
    readonly tape: Tape,
    readonly index: number,
  ) {}

  get primal(): number { return this.tape.primal(this.index) }

  add(other: DualValue): DualValue {
    return new DualValue(this.tape, this.tape.pushBinary(
      OpKind.Add, this.index, other.index, this.primal + other.primal))
  }

  sub(other: DualValue): DualValue {
    return new DualValue(this.tape, this.tape.pushBinary(
      OpKind.Sub, this.index, other.index, this.primal - other.primal))
  }

  mul(other: DualValue): DualValue {
    return new DualValue(this.tape, this.tape.pushBinary(
      OpKind.Mul, this.index, other.index, this.primal * other.primal))
  }

  div(other: DualValue): DualValue {
    return new DualValue(this.tape, this.tape.pushBinary(
      OpKind.Div, this.index, other.index, this.primal / other.primal))
  }

  mod(other: DualValue): DualValue {
    return new DualValue(this.tape, this.tape.pushBinary(
      OpKind.Mod, this.index, other.index, this.primal % other.primal))
  }

  pow(other: DualValue): DualValue {
    return new DualValue(this.tape, this.tape.pushBinary(
      OpKind.Pow, this.index, other.index, this.primal ** other.primal))
  }

  neg(): DualValue {
    return new DualValue(this.tape, this.tape.pushUnary(
      OpKind.Neg, this.index, -this.primal))
  }

  abs(): DualValue {
    return new DualValue(this.tape, this.tape.pushUnary(
      OpKind.Abs, this.index, Math.abs(this.primal)))
  }

  min(other: DualValue): DualValue {
    return new DualValue(this.tape, this.tape.pushBinary(
      OpKind.Min, this.index, other.index, Math.min(this.primal, other.primal)))
  }

  max(other: DualValue): DualValue {
    return new DualValue(this.tape, this.tape.pushBinary(
      OpKind.Max, this.index, other.index, Math.max(this.primal, other.primal)))
  }

  toNumber(): number {
    return this.primal
  }
}

/** Create a constant DualValue on an existing tape. */
export function dual(tape: Tape, value: number): DualValue {
  return new DualValue(tape, tape.pushConst(value))
}

/**
 * Compute gradients of a scalar output w.r.t. named parameters.
 *
 * This resets the tape, runs backward from the output node, and reads
 * the adjoint of each parameter node. The tape can be extended with
 * post-hoc expressions (e.g. a distance loss) before calling this —
 * no need to re-evaluate the original program.
 */
export function computeGradient(
  tape: Tape,
  outputIndex: number,
  parameterNodes: Map<string, number>,
): Map<string, number> {
  tape.reset()
  tape.backward(outputIndex)
  const grad = new Map<string, number>()
  for (const [name, nodeIndex] of parameterNodes) {
    grad.set(name, tape.adjoint(nodeIndex))
  }
  return grad
}



/**
 * Wengert list (tape) for reverse-mode automatic differentiation.
 *
 * Nodes are appended in evaluation order, which is a valid topological sort.
 * Forward pass: traverse 0 → n (implicit during evaluation).
 * Backward pass: traverse n → 0, accumulating adjoints via chain rule.
 *
 * For repeated forward/backward (optimization), use extractSubTape() to
 * get a compact Tape containing only the nodes reachable from the loss.
 */


export enum OpKind {
  Const,
  Add,
  Sub,
  Mul,
  Div,
  Mod,
  Pow,
  Neg,
  Abs,
  Min,
  Max,
}


export type TapeNode = {
  op: OpKind
  inputA: number     // -1 if N/A (Const)
  inputB: number     // -1 if N/A (Const, unary)
  primal: number
  adjoint: number
}


export class Tape {
  readonly nodes: TapeNode[] = []

  /** Named parameter node indices. Populated by extractSubTape(). */
  paramIndices: Map<string, number> = new Map()

  pushConst(value: number): number {
    const idx = this.nodes.length
    this.nodes.push({ op: OpKind.Const, inputA: -1, inputB: -1, primal: value, adjoint: 0 })
    return idx
  }

  pushUnary(op: OpKind, input: number, primal: number): number {
    const idx = this.nodes.length
    this.nodes.push({ op, inputA: input, inputB: -1, primal, adjoint: 0 })
    return idx
  }

  pushBinary(op: OpKind, lhs: number, rhs: number, primal: number): number {
    const idx = this.nodes.length
    this.nodes.push({ op, inputA: lhs, inputB: rhs, primal, adjoint: 0 })
    return idx
  }

  primal(index: number): number {
    return this.nodes[index].primal
  }

  adjoint(index: number): number {
    return this.nodes[index].adjoint
  }

  /** Zero all adjoints so backward() can be re-run from a different output. */
  reset(): void {
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].adjoint = 0
    }
  }

  /**
   * Reverse-mode backward pass. Seeds the output node's adjoint to 1 and
   * propagates adjoints to all ancestors via per-operation chain rules.
   *
   * Call reset() first if the tape has been used for a previous backward pass.
   */
  backward(outputIndex: number): void {
    this.nodes[outputIndex].adjoint += 1
    backwardPass(this.nodes, outputIndex)
  }

  // ---- Methods for optimization (used on extracted sub-tapes) ----

  /**
   * Re-run the forward pass with updated parameter values.
   * Injects params into their Const nodes, then recomputes all non-Const
   * nodes in topological order. Returns the last node's primal (the loss).
   */
  forward(params: Map<string, number>): number {
    const n = this.nodes
    for (const [name, idx] of this.paramIndices) {
      const v = params.get(name)
      if (v !== undefined) n[idx].primal = v
    }
    for (let i = 0; i < n.length; i++) {
      const node = n[i]
      if (node.op === OpKind.Const) continue
      const a = n[node.inputA].primal
      const b = node.inputB >= 0 ? n[node.inputB].primal : 0
      switch (node.op) {
        case OpKind.Add: node.primal = a + b; break
        case OpKind.Sub: node.primal = a - b; break
        case OpKind.Mul: node.primal = a * b; break
        case OpKind.Div: node.primal = a / b; break
        case OpKind.Mod: node.primal = a % b; break
        case OpKind.Pow: node.primal = a ** b; break
        case OpKind.Neg: node.primal = -a; break
        case OpKind.Abs: node.primal = Math.abs(a); break
        case OpKind.Min: node.primal = Math.min(a, b); break
        case OpKind.Max: node.primal = Math.max(a, b); break
      }
    }
    return n[n.length - 1].primal
  }

  /** Read the gradient of the output w.r.t. a named parameter. */
  grad(param: string): number {
    const idx = this.paramIndices.get(param)
    if (idx === undefined) return 0
    return this.nodes[idx].adjoint
  }

  /**
   * Forward with new params, then reset + backward from the last node.
   * Returns the loss value. This is the hot-loop primitive for optimization.
   */
  forwardBackward(params: Map<string, number>): number {
    const loss = this.forward(params)
    this.reset()
    this.backward(this.nodes.length - 1)
    return loss
  }
}


/** Backward pass logic shared across all uses. */
function backwardPass(nodes: TapeNode[], from: number): void {
  for (let i = from; i >= 0; i--) {
    const node = nodes[i]
    const a = node.adjoint
    if (a === 0) continue

    switch (node.op) {
      case OpKind.Const:
        break

      case OpKind.Add:
        nodes[node.inputA].adjoint += a
        nodes[node.inputB].adjoint += a
        break

      case OpKind.Sub:
        nodes[node.inputA].adjoint += a
        nodes[node.inputB].adjoint -= a
        break

      case OpKind.Mul: {
        const xp = nodes[node.inputA].primal
        const yp = nodes[node.inputB].primal
        nodes[node.inputA].adjoint += a * yp
        nodes[node.inputB].adjoint += a * xp
        break
      }

      case OpKind.Div: {
        const xp = nodes[node.inputA].primal
        const yp = nodes[node.inputB].primal
        nodes[node.inputA].adjoint += a / yp
        nodes[node.inputB].adjoint -= a * xp / (yp * yp)
        break
      }

      case OpKind.Mod: {
        const xp = nodes[node.inputA].primal
        const yp = nodes[node.inputB].primal
        nodes[node.inputA].adjoint += a
        nodes[node.inputB].adjoint -= a * Math.floor(xp / yp)
        break
      }

      case OpKind.Pow: {
        const xp = nodes[node.inputA].primal
        const yp = nodes[node.inputB].primal
        nodes[node.inputA].adjoint += a * yp * xp ** (yp - 1)
        nodes[node.inputB].adjoint += a * xp ** yp * Math.log(xp)
        break
      }

      case OpKind.Neg:
        nodes[node.inputA].adjoint -= a
        break

      case OpKind.Abs: {
        const xp = nodes[node.inputA].primal
        nodes[node.inputA].adjoint += a * Math.sign(xp)
        break
      }

      case OpKind.Min: {
        const xp = nodes[node.inputA].primal
        const yp = nodes[node.inputB].primal
        if (xp <= yp) {
          nodes[node.inputA].adjoint += a
        } else {
          nodes[node.inputB].adjoint += a
        }
        break
      }

      case OpKind.Max: {
        const xp = nodes[node.inputA].primal
        const yp = nodes[node.inputB].primal
        if (xp >= yp) {
          nodes[node.inputA].adjoint += a
        } else {
          nodes[node.inputB].adjoint += a
        }
        break
      }
    }
  }
}


/**
 * Extract a compact Tape containing only the nodes reachable from
 * `outputIndex`. The returned tape has `paramIndices` populated and is
 * ready for repeated `forwardBackward()` calls.
 */
export function extractSubTape(
  tape: Tape,
  outputIndex: number,
  parameterNodes: Map<string, number>,
): Tape {
  const src = tape.nodes

  // 1. Find all reachable nodes via backward sweep
  const reachable = new Uint8Array(src.length)
  reachable[outputIndex] = 1
  for (let i = outputIndex; i >= 0; i--) {
    if (!reachable[i]) continue
    const node = src[i]
    if (node.inputA >= 0) reachable[node.inputA] = 1
    if (node.inputB >= 0) reachable[node.inputB] = 1
  }

  // 2. Build index remap (original → sub-tape), preserving topological order
  const remap = new Int32Array(src.length).fill(-1)
  let count = 0
  for (let i = 0; i < src.length; i++) {
    if (reachable[i]) remap[i] = count++
  }

  // 3. Build the new tape with remapped nodes
  const sub = new Tape()
  for (let i = 0; i < src.length; i++) {
    if (!reachable[i]) continue
    const s = src[i]
    sub.nodes.push({
      op: s.op,
      inputA: s.inputA >= 0 ? remap[s.inputA] : -1,
      inputB: s.inputB >= 0 ? remap[s.inputB] : -1,
      primal: s.primal,
      adjoint: 0,
    })
  }

  // 4. Remap parameter indices
  for (const [name, origIdx] of parameterNodes) {
    const sub_idx = remap[origIdx]
    if (sub_idx >= 0) sub.paramIndices.set(name, sub_idx)
  }

  return sub
}
