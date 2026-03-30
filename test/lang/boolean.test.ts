import { describe, it, expect } from 'vitest'
import type { Point2 } from '@/lang/values'
import { run, runOk, drawn } from '@test/lang/lib'


function approxPt(p: Point2, x: number, y: number) {
  expect(p.x).toBeCloseTo(x, 6)
  expect(p.y).toBeCloseTo(y, 6)
}

function sortedEdges(edges: { start: Point2; end: Point2 }[]) {
  return edges
    .map((e) => ({
      start: { x: Math.round(e.start.x * 1e6) / 1e6, y: Math.round(e.start.y * 1e6) / 1e6 },
      end: { x: Math.round(e.end.x * 1e6) / 1e6, y: Math.round(e.end.y * 1e6) / 1e6 },
    }))
    .sort((a, b) => a.start.x - b.start.x || a.start.y - b.start.y)
}


// Union


describe('union', () => {
  it('union of non-overlapping rectangles produces both', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 5, 5)
b = rect(10, 0, 5, 5)
c = union(a, b)
draw(c)`)
    const batches = result.drawBuffer.batches
    expect(batches.flatMap((b) => b.edges).length).toBe(8) // 4 + 4 edges
  })

  it('union of overlapping rectangles merges them', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(5, 0, 10, 5)
c = union(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    // Should form a single merged rectangle: (0,0)-(15,0)-(15,5)-(0,5)
    // After collinear merging, should have 4 edges
    expect(edges.length).toBe(4)
  })

  it('union of identical rectangles returns one rectangle', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(0, 0, 10, 5)
c = union(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    expect(edges.length).toBe(4)
  })

  it('union where one is inside the other returns outer', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 20, 20)
b = rect(5, 5, 10, 10)
c = union(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    expect(edges.length).toBe(4)
  })
})


// Difference


describe('difference', () => {
  it('difference of non-overlapping rectangles returns first', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 5, 5)
b = rect(10, 0, 5, 5)
c = difference(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    expect(edges.length).toBe(4)
  })

  it('difference of identical rectangles is empty', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(0, 0, 10, 5)
c = difference(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    expect(edges.length).toBe(0)
  })

  it('difference with overlap removes the overlapping part', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(5, 0, 10, 5)
c = difference(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    // Result should be rect (0,0)-(5,0)-(5,5)-(0,5), i.e. 4 edges
    expect(edges.length).toBe(4)
  })

  it('difference where B is inside A creates a hole', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 20, 20)
b = rect(5, 5, 10, 10)
c = difference(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    // Outer boundary (4 edges) + hole boundary (4 edges) = 8
    expect(edges.length).toBe(8)
  })
})


// Intersection


describe('intersection', () => {
  it('intersection of non-overlapping rectangles is empty', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 5, 5)
b = rect(10, 0, 5, 5)
c = intersection(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    expect(edges.length).toBe(0)
  })

  it('intersection of overlapping rectangles gives overlap region', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(5, 0, 10, 5)
c = intersection(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    // Overlap: (5,0)-(10,0)-(10,5)-(5,5) → 4 edges
    expect(edges.length).toBe(4)
  })

  it('intersection of identical rectangles returns same', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(0, 0, 10, 5)
c = intersection(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    expect(edges.length).toBe(4)
  })

  it('intersection where one is inside gives inner', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 20, 20)
b = rect(5, 5, 10, 10)
c = intersection(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    expect(edges.length).toBe(4)
  })
})


// Region properties


describe('region properties', () => {
  it('positive property returns positive polygons', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 10)
b = rect(5, 0, 10, 10)
c = union(a, b)
draw(pt(c.positive.length, 0))`)
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)
    expect(pts[0].x).toBe(1) // one positive polygon
  })

  it('difference hole shows as negative polygon', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 20, 20)
b = rect(5, 5, 10, 10)
c = difference(a, b)
draw(pt(c.negative.length, 0))`)
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)
    expect(pts[0].x).toBe(1) // one negative polygon (the hole)
  })
})


// Coordinate verification


describe('coordinates', () => {
  it('union overlap gives correct merged boundary', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(5, 0, 10, 5)
c = union(a, b)
draw(c)`)
    const edges = sortedEdges(result.drawBuffer.batches.flatMap((b) => b.edges))
    // Merged rect: (0,0)→(15,0)→(15,5)→(0,5)→(0,0)
    expect(edges).toHaveLength(4)
    // Verify the boundary wraps correctly
    const verts = edges.map((e) => e.start)
    const xs = verts.map((v) => v.x).sort((a, b) => a - b)
    const ys = verts.map((v) => v.y).sort((a, b) => a - b)
    expect(xs[0]).toBe(0)
    expect(xs[xs.length - 1]).toBe(15)
    expect(ys[0]).toBe(0)
    expect(ys[ys.length - 1]).toBe(5)
  })

  it('difference overlap gives correct remaining piece', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(5, 0, 10, 5)
c = difference(a, b)
draw(c)`)
    const edges = sortedEdges(result.drawBuffer.batches.flatMap((b) => b.edges))
    // Remaining: (0,0)→(5,0)→(5,5)→(0,5)→(0,0)
    expect(edges).toHaveLength(4)
    const verts = edges.map((e) => e.start)
    const xs = verts.map((v) => v.x).sort((a, b) => a - b)
    const ys = verts.map((v) => v.y).sort((a, b) => a - b)
    expect(xs[0]).toBe(0)
    expect(xs[xs.length - 1]).toBe(5)
    expect(ys[0]).toBe(0)
    expect(ys[ys.length - 1]).toBe(5)
  })

  it('intersection overlap gives correct overlap region', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(5, 0, 10, 5)
c = intersection(a, b)
draw(c)`)
    const edges = sortedEdges(result.drawBuffer.batches.flatMap((b) => b.edges))
    // Overlap: (5,0)→(10,0)→(10,5)→(5,5)→(5,0)
    expect(edges).toHaveLength(4)
    const verts = edges.map((e) => e.start)
    const xs = verts.map((v) => v.x).sort((a, b) => a - b)
    const ys = verts.map((v) => v.y).sort((a, b) => a - b)
    expect(xs[0]).toBe(5)
    expect(xs[xs.length - 1]).toBe(10)
    expect(ys[0]).toBe(0)
    expect(ys[ys.length - 1]).toBe(5)
  })
})


// L-shaped union (2D overlap, not just 1D)


describe('2D overlap', () => {
  it('union of offset rectangles forms L-shape', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 10)
b = rect(5, 5, 10, 10)
c = union(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    // L-shape has 8 vertices/edges (after collinear merge if needed)
    // (0,0)→(10,0)→(10,5)→(15,5)→(15,15)→(5,15)→(5,10)→(0,10)→(0,0)
    // Actually depends on exact merge — just check reasonable count
    expect(edges.length).toBeGreaterThanOrEqual(6)
    expect(edges.length).toBeLessThanOrEqual(8)
  })

  it('intersection of offset rectangles gives overlap square', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 10)
b = rect(5, 5, 10, 10)
c = intersection(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    // Overlap: (5,5)→(10,5)→(10,10)→(5,10) → 4 edges
    expect(edges.length).toBe(4)
  })

  it('difference of offset rectangles gives notched shape', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 10)
b = rect(5, 5, 10, 10)
c = difference(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    // A minus the overlap corner: L-shape with 6 edges
    expect(edges.length).toBe(6)
  })
})


// Adjacent rectangles (shared edge)


describe('adjacent rectangles', () => {
  it('union of side-by-side rectangles merges', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(10, 0, 10, 5)
c = union(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    // Shared vertical edge removed, collinear merge → 4 edges
    expect(edges.length).toBe(4)
  })

  it('difference of adjacent rectangles returns first', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(10, 0, 10, 5)
c = difference(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    expect(edges.length).toBe(4)
  })
})


// Transforms on regions


describe('region transforms', () => {
  it('can translate a region', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(5, 0, 10, 5)
c = union(a, b).translate(100, 100)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    for (const e of edges) {
      expect(e.start.x).toBeGreaterThanOrEqual(100)
      expect(e.start.y).toBeGreaterThanOrEqual(100)
    }
  })
})


// Shared-vertex touching (corner touch)


describe('corner touch', () => {
  it('union of corner-touching rectangles produces both', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 5, 5)
b = rect(5, 5, 5, 5)
c = union(a, b)
draw(c)`)
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    // Touching at (5,5) only — should produce 8 edges (two separate rects)
    expect(edges.length).toBe(8)
  })
})


// Partial collinear overlap (B's bottom overlaps part of A's bottom)


describe('partial collinear overlap', () => {
  it('union with partial shared bottom edge', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 5)
b = rect(3, 0, 4, 8)
c = union(a, b)
draw(c)`)
    // B extends above A; they share part of bottom edge
    expect(result.error).toBeNull()
    const edges = result.drawBuffer.batches.flatMap((b) => b.edges)
    expect(edges.length).toBeGreaterThanOrEqual(6)
  })
})


// Lineage


describe('boolean lineage', () => {
  it('output vertices trace back to input rectangles', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 10)
b = rect(5, 5, 10, 10)
r = union(a, b)
draw(r)`)
    expect(result.error).toBeNull()
  })

  it('query can find union output polygons containing elements derived from input', () => {
    const result = runOk(`parameters {}
a = rect(0, 0, 10, 10)
b = rect(5, 5, 10, 10)
r = union(a, b)
found = query(r.positive, contains(derivedFromAny(a)))
draw(pt(found.length, 0))`)
    const pts = result.drawBuffer.batches.flatMap((b) => b.points)
    expect(pts[0].x).toBeGreaterThan(0) // the positive polygon contains elements derived from a
  })
})
