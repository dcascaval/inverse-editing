// Typed wrapper for nlopt-js — adapted from nlopt-js/src/nlopt.mjs

import { GC } from '@/vendor/nlopt/gc'

// TypeScript types for the nlopt API

export type ScalarFunction = (x: Float64Array, grad: Float64Array | null) => number

export type VectorFunction = (x: Float64Array, grad: Float64Array | null, result: Float64Array) => void

// Opaque algorithm handle — values come from the WASM module at runtime.
// Use nlopt.Algorithm.LD_SLSQP etc. after awaiting nlopt.ready.
export type Algorithm = { readonly __brand: 'NLoptAlgorithm' }

export type AlgorithmMap = {
  GN_DIRECT: Algorithm
  GN_DIRECT_L: Algorithm
  GN_DIRECT_L_RAND: Algorithm
  GN_DIRECT_NOSCAL: Algorithm
  GN_DIRECT_L_NOSCAL: Algorithm
  GN_DIRECT_L_RAND_NOSCAL: Algorithm
  GN_ORIG_DIRECT: Algorithm
  GN_ORIG_DIRECT_L: Algorithm
  GD_STOGO: Algorithm
  GD_STOGO_RAND: Algorithm
  LD_LBFGS_NOCEDAL: Algorithm
  LD_LBFGS: Algorithm
  LN_PRAXIS: Algorithm
  LD_VAR1: Algorithm
  LD_VAR2: Algorithm
  LD_TNEWTON: Algorithm
  LD_TNEWTON_RESTART: Algorithm
  LD_TNEWTON_PRECOND: Algorithm
  LD_TNEWTON_PRECOND_RESTART: Algorithm
  GN_CRS2_LM: Algorithm
  GN_MLSL: Algorithm
  GD_MLSL: Algorithm
  GN_MLSL_LDS: Algorithm
  GD_MLSL_LDS: Algorithm
  LD_MMA: Algorithm
  LN_COBYLA: Algorithm
  LN_NEWUOA: Algorithm
  LN_NEWUOA_BOUND: Algorithm
  LN_NELDERMEAD: Algorithm
  LN_SBPLX: Algorithm
  LN_AUGLAG: Algorithm
  LD_AUGLAG: Algorithm
  LN_AUGLAG_EQ: Algorithm
  LD_AUGLAG_EQ: Algorithm
  LN_BOBYQA: Algorithm
  GN_ISRES: Algorithm
  AUGLAG: Algorithm
  AUGLAG_EQ: Algorithm
  G_MLSL: Algorithm
  G_MLSL_LDS: Algorithm
  LD_SLSQP: Algorithm
  LD_CCSAQ: Algorithm
  GN_ESCH: Algorithm
}

export interface OptimizeResult {
  x: number[]
  value: number
  success: boolean
}

export interface Optimize {
  setMinObjective(fn: ScalarFunction, tolerance: number): void
  setMaxObjective(fn: ScalarFunction, tolerance: number): void
  setLowerBounds(bounds: number[]): void
  setUpperBounds(bounds: number[]): void
  addInequalityConstraint(fn: ScalarFunction, tolerance: number): void
  addEqualityConstraint(fn: ScalarFunction, tolerance: number): void
  addInequalityMConstraint(fn: VectorFunction, tolerances: number[]): void
  addEqualityMConstraint(fn: VectorFunction, tolerances: number[]): void
  setMaxtime(seconds: number): void
  setMaxeval(count: number): void
  optimize(x0: number[]): OptimizeResult
}

export interface NLopt {
  GC: typeof GC
  Algorithm: AlgorithmMap
  Optimize: new (algorithm: Algorithm, dimensions: number) => Optimize
  ready: Promise<void>
}


// Module initialization

function addHelpers(module: any, nlopt: any) {
  module.Vector.fromArray = function (arr: number[]) {
    const v = new module.Vector()
    arr.forEach((val: number) => v.push_back(val))
    return v
  }

  module.Vector.toArray = function (vec: any) {
    const a = new Array(vec.size())
    for (let k = 0; k < vec.size(); k++) a[k] = vec.get(k)
    return a
  }

  module.ScalarFunction.fromLambda = (fun: ScalarFunction) => {
    return module.ScalarFunction.implement({
      value: (n: number, xPtr: number, gradPtr: number) => {
        const x = new Float64Array(nlopt.HEAPF64.buffer, xPtr, n)
        const grad = gradPtr ? new Float64Array(nlopt.HEAPF64.buffer, gradPtr, n) : null
        return fun(x, grad)
      },
    })
  }

  module.VectorFunction.fromLambda = (fun: VectorFunction) => {
    return module.VectorFunction.implement({
      value: (m: number, rPtr: number, n: number, xPtr: number, gradPtr: number) => {
        const x = new Float64Array(nlopt.HEAPF64.buffer, xPtr, n)
        const r = new Float64Array(nlopt.HEAPF64.buffer, rPtr, m)
        const grad = gradPtr ? new Float64Array(nlopt.HEAPF64.buffer, gradPtr, n * m) : null
        return fun(x, grad, r)
      },
    })
  }

  // Simplify argument syntax: auto-convert JS arrays/lambdas to WASM types
  const argsTransformMap: Record<string, any[]> = {
    setLowerBounds: [module.Vector],
    setUpperBounds: [module.Vector],
    setMinObjective: [module.ScalarFunction, null],
    setMaxObjective: [module.ScalarFunction, null],
    addInequalityConstraint: [module.ScalarFunction, null],
    addEqualityConstraint: [module.ScalarFunction, null],
    addInequalityMConstraint: [module.VectorFunction, module.Vector],
    addEqualityMConstraint: [module.VectorFunction, module.Vector],
    optimize: [module.Vector],
  }

  for (const method of Object.keys(argsTransformMap)) {
    const argsTransform = argsTransformMap[method]
    const fun = nlopt.Optimize.prototype[method]

    nlopt.Optimize.prototype[method] = function (...args: any[]) {
      for (let k = 0; k < args.length; k++) {
        const t = argsTransform[k]
        if (t === module.Vector) args[k] = module.Vector.fromArray(args[k])
        else if (t === module.VectorFunction) args[k] = module.VectorFunction.fromLambda(args[k])
        else if (t === module.ScalarFunction) args[k] = module.ScalarFunction.fromLambda(args[k])
      }
      const rtn = fun.call(this, ...args)
      if (method === 'optimize' && rtn.x instanceof module.Vector) {
        rtn.x = module.Vector.toArray(rtn.x)
      }
      return rtn
    }
  }
}

async function loadEmscriptenModule(): Promise<any> {

  if (typeof window !== 'undefined') {
    // Browser: dynamic import (Vite handles this)
    const mod = await import('./nlopt_gen.cjs')
    const factory = mod.default ?? mod
    const wasmUrl = new URL('./nlopt_gen.wasm', import.meta.url).href
    const wasmResp = await fetch(wasmUrl)
    const wasmBinary = await wasmResp.arrayBuffer()
    return factory({ wasmBinary })
  }

  // Node.js: use createRequire for CJS compat, load wasm from disk
  const { createRequire } = await import('module')
  const { readFileSync } = await import('fs')
  const { fileURLToPath } = await import('url')
  const { dirname, join } = await import('path')
  const _require = createRequire(import.meta.url)
  const factory = _require('./nlopt_gen.cjs')
  const dir = dirname(fileURLToPath(import.meta.url))
  const wasmBinary = readFileSync(join(dir, 'nlopt_gen.wasm'))
  return factory({ wasmBinary })
}


const nlopt: NLopt = {
  GC,
  Algorithm: null!,
  Optimize: null!,
  ready: null!,
}

nlopt.ready = (async () => {
  const wasmModule = await loadEmscriptenModule()

  const classes = new Set(['Optimize'])
  nlopt.Optimize = GC.initClass(classes, wasmModule.Optimize)
  nlopt.Algorithm = wasmModule.Algorithm
  
  (nlopt as any).HEAPF64 = wasmModule.HEAPF64
  addHelpers(wasmModule, nlopt)
})()

export default nlopt
