import { describe, it, expect } from 'vitest'
import { run, drawnPointCount, drawnEdgeCount } from './lib'


// from / fromAny (direct edges only)


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
    expect(count).toBe(2)
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

  it('from() edge→points via containment: edge contains its endpoints', () => {
    const count = drawnPointCount(`parameters {}
r0 = rect(0, 0, 10, 10)
r1 = r0.translate(20, 20)
draw(query(r1.points, from(r0.top)))`)
    expect(count).toBe(2)
  })

  it('from() rect→points via containment: rect contains all its points', () => {
    const count = drawnPointCount(`parameters {}
r0 = rect(0, 0, 10, 10)
r1 = r0.translate(20, 20)
draw(query(r1.points, from(r0)))`)
    expect(count).toBe(4)
  })

  it('from() rect→edges via containment: rect contains all its edges', () => {
    const count = drawnEdgeCount(`parameters {}
r0 = rect(0, 0, 10, 10)
r1 = r0.translate(20, 20)
draw(query(r1.edges, from(r0)))`)
    expect(count).toBe(4)
  })

  it('from() point containment is just itself', () => {
    const count = drawnPointCount(`parameters {}
r0 = rect(0, 0, 10, 10)
r1 = r0.translate(20, 20)
draw(query(r1.points, from(r0.bottomLeft)))`)
    expect(count).toBe(1)
  })
})


// derivedFrom / derivedFromAny (direct + indirect edges)


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


// Query operators (not, and, or)


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

  it('contains() expands candidate by containment', () => {
    // Without contains: querying edges for from(a.bottomLeft) only finds edges
    // that are themselves directly reachable from a.bottomLeft — none are.
    // With contains: each candidate edge is expanded to include its endpoints,
    // so b.bottom matches because b.bottomLeft (contained in b.bottom) is
    // reachable from a.bottomLeft.
    const without = drawnEdgeCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.edges, from(a.bottomLeft)))`)
    expect(without).toBe(0)

    const with_ = drawnEdgeCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.edges, contains(from(a.bottomLeft))))`)
    expect(with_).toBe(2)
  })

  it('contains() with rect candidates', () => {
    // A rect in an array: contains() expands it to all its points and edges.
    // from(a.bottomLeft) should match because b contains b.bottomLeft which
    // is reachable from a.bottomLeft.
    const count = drawnPointCount(`parameters {}
a = rect(0, 0, 10, 10)
b = a.translate(20, 0)
draw(query(b.points, contains(from(a.top))))`)
    // contains() on points is the same as without — points contain only themselves
    expect(count).toBe(2)
  })
})
