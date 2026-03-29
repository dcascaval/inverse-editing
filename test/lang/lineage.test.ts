import { describe, it, expect } from 'vitest'
import { run, drawnPointCount, drawnEdgeCount } from './lib'

// ---------------------------------------------------------------------------
// from / fromAny (direct edges only)
// ---------------------------------------------------------------------------

describe('from (direct edges only)', () => {
  it('from() point→point: single corner returns 1 point', () => {
    const count = drawnPointCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.points, from(a.bottomLeft)))`)
    expect(count).toBe(1)
  })

  it('from() edge→edge: finds transformed edge', () => {
    const count = drawnEdgeCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.edges, from(a.bottom)))`)
    expect(count).toBe(1)
  })

  it('from() does not cross indirect edges', () => {
    const count = drawnPointCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.points, from(a.bottom)))`)
    expect(count).toBe(0)
  })

  it('fromAny() matches points reachable from any arg', () => {
    const count = drawnPointCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.points, fromAny(a.bottomLeft, a.topRight)))`)
    expect(count).toBe(2)
  })

  it('chained transforms preserve direct lineage', () => {
    const count = drawnPointCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
c = b.scale(2)
draw(query(c.points, from(a.bottomLeft)))`)
    expect(count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// derivedFrom / derivedFromAny (direct + indirect edges)
// ---------------------------------------------------------------------------

describe('derivedFrom (direct + indirect edges)', () => {
  it('derivedFrom() corner finds edges that depend on it', () => {
    const count = drawnEdgeCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.edges, derivedFrom(a.bottomLeft)))`)
    expect(count).toBe(2)
  })

  it('derivedFrom() corner with right returns 2 edges', () => {
    const count = drawnEdgeCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.edges, derivedFrom(a.topRight)))`)
    expect(count).toBe(2)
  })

  it('derivedFrom() with multiple corners requires all reachable', () => {
    const count = drawnEdgeCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.edges, derivedFrom(a.bottomLeft, a.bottomRight)))`)
    expect(count).toBe(1)
  })

  it('derivedFromAny() on edges matches edges reachable from any corner', () => {
    const count = drawnEdgeCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.edges, derivedFromAny(a.bottomLeft, a.topRight)))`)
    expect(count).toBe(4)
  })

  it('chained transforms preserve derived lineage', () => {
    const count = drawnEdgeCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
c = b.scale(2)
draw(query(c.edges, derivedFrom(a.bottomLeft)))`)
    expect(count).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Query operators (not, and, or)
// ---------------------------------------------------------------------------

describe('query operators', () => {
  it('not() negates a query', () => {
    const count = drawnPointCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.points, not(from(a.bottomLeft))))`)
    expect(count).toBe(3)
  })

  it('and combines two queries', () => {
    const count = drawnEdgeCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.edges, derivedFrom(a.bottomLeft) and derivedFrom(a.bottomRight)))`)
    expect(count).toBe(1)
  })

  it('or combines two queries', () => {
    const count = drawnEdgeCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.edges, derivedFrom(a.bottomLeft) or derivedFrom(a.bottomRight)))`)
    expect(count).toBe(3)
  })

  it('draw handles array values from query', () => {
    const { drawBuffer } = run(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.edges, derivedFrom(a.bottomLeft)))`)
    expect(drawBuffer.batches).toHaveLength(1)
    expect(drawBuffer.batches[0].edges).toHaveLength(2)
  })
})
