LIVE DEMO HERE: https://dcascaval.github.io/inverse-editing/

# Inverse editing

A parametric 2.5 CAD system with direct manipulation: write programs that generate geometry, then drag edges to edit the geometry directly, optimizing parameters even across topological changes. Enables querying elements via reachability in topological provenance graph from known elements (lineage), and automatically synthesizing lineage references for elements to impose constraints preserved where possible.

## Control Flow

```
Code / Sliders
      |
      v
  Parse (string -> AST)
      |
      v
  Execute (interpreter + dual numbers)
      |
      |   Dual mode: arithmetic recorded on a Tape (DualValue)
      |
      |   During execution:
      |     - LineageGraph tracks which root primitives
      |       (corners, edges) flow into which values
      |     - Queries compose predicates over lineage
      |       (from/fromAny, and/or/not, contains)
      |     - draw() calls accumulate intermediate geometry
      |
      v
  Render (R3F / Three.js from drawn data)
      |
      v
  User drags an edge
      |
      v
  Build drag session (on drag start)
      |--- Find closest edge in world space
      |--- Construct loss on the Tape:
      |      distance to target
      |      + selectivity-weighted regularization
      |      + locked vertex penalties (hold position)
      |--- Extract sub-tape (only reachable nodes)
      |
      v
  Optimize (as dragging: optimize, respects param bounds)
      |--- Forward pass: recompute primals
      |--- Backward pass: reverse-mode AD for gradients
      |--- Update slider values
      |
      v
  Re-execute program -> re-render
```

The same interpreter code can both real and dual mode via `NumericValue` interface. In dual mode every arithmetic op appends to a Tape (Wengert list) for reverse-mode AD. Lineage tracking is separate from the numeric tape -- it records topological provenance so queries can select geometry by origin (e.g. "edges from the left side of rectangle A") in reference to known, prior geometry (can be a root primitive, or other queries.)

Selectivity weighting makes dragging intuitive: for each parameter, a forward-mode tangent pass measures how much the dragged point moves vs. how much everything else moves. Parameters that broadly affect the whole shape get penalized, so the optimizer prefers local, targeted adjustments.

You can Alt+click vertices to lock them. Locks are identified by lineage root indices, so they survive re-execution (re-resolved against the new lineage graph and tape each time). During optimization, each active lock adds a weighted penalty term that keeps the locked vertex at its position from drag start, letting you pin parts of the shape while dragging others, even across topological changes.

## File Map

### Language (`src/lang/`)

- `ast.ts` -- AST node type definitions
- `lexer.ts`/`parser.ts` -- Program -> AST
- `numeric.ts` -- Polymorphic NumericValue interface and RealValue implementation
- `grad.ts` -- DualValue, Tape, reverse/forward-mode AD
- `values.ts` -- Runtime value types: points, edges, polygons, lambdas
- `interpreter.ts` -- AST evaluator, polymorphic over NumericValue
- `lineage.ts` -- Lineage graph tracking root primitive provenance
- `query.ts` -- Compositional predicates over lineage (from/fromAny, and/or/not, contains)
- `stdlib.ts` -- Language functions: geometry constructors, transforms, draw

### Geometry (`src/geometry/`)

- `transform.ts` -- 2D/3D affine transform matrices and composition
- `boolean.ts` -- Polygon boolean ops: union, difference, intersection
- `polygon.ts`/`chamfer.ts` -- Other polygon operations
- `three.ts` -- Three.js mesh generation from polygons and extrusions

### Optimization (`src/optimize/`)

- `drag.ts` -- Drag session, loss construction, selectivity-weighted regularization

### App (`src/`, `src/components/`)

- `App.tsx` -- Root layout: viewport, sliders, editor columns
- `store.ts` -- Zustand store for all application state
- `execute.ts` -- Orchestrates parse, execute, render pipeline
- `Viewport.tsx` -- 3D canvas with edge/face drag interaction
- `DragDrop.tsx` -- Screen-to-world coordinate conversion, drag lifecycle

## Development 

Standard client side web app, uses bun/vite.
- `git clone`
- `bun install`
- `bun dev` to get a local dev server
- Open up locahost:5173 in browser to try it out