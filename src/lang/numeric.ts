/**
 * NumericValue — abstract numeric representation for shape program values.
 *
 * The baseline RealValue wraps a plain `number`. Alternative implementations
 * (e.g. dual numbers for automatic differentiation) can implement the same
 * interface and be threaded through the interpreter.
 */


export interface NumericValue<Self extends NumericValue<Self> = any> {
  add(other: Self): Self
  sub(other: Self): Self
  mul(other: Self): Self
  div(other: Self): Self
  mod(other: Self): Self
  pow(other: Self): Self
  neg(): Self
  abs(): Self
  sin(): Self
  cos(): Self
  min(other: Self): Self
  max(other: Self): Self
  toNumber(): number
}


// Baseline implementation: thin wrapper over IEEE 754 doubles.

export class RealValue implements NumericValue<RealValue> {
  readonly value: number
  constructor(value: number) { this.value = value }

  add(other: RealValue): RealValue { return new RealValue(this.value + other.value) }
  sub(other: RealValue): RealValue { return new RealValue(this.value - other.value) }
  mul(other: RealValue): RealValue { return new RealValue(this.value * other.value) }
  div(other: RealValue): RealValue { return new RealValue(this.value / other.value) }
  mod(other: RealValue): RealValue { return new RealValue(this.value % other.value) }
  pow(other: RealValue): RealValue { return new RealValue(this.value ** other.value) }
  neg(): RealValue { return new RealValue(-this.value) }
  abs(): RealValue { return new RealValue(Math.abs(this.value)) }
  sin(): RealValue { return new RealValue(Math.sin(this.value)) }
  cos(): RealValue { return new RealValue(Math.cos(this.value)) }
  min(other: RealValue): RealValue { return new RealValue(Math.min(this.value, other.value)) }
  max(other: RealValue): RealValue { return new RealValue(Math.max(this.value, other.value)) }
  toNumber(): number { return this.value }
}

/** Wrap a plain number as a NumericValue. */
export function real(n: number): RealValue {
  return new RealValue(n)
}
