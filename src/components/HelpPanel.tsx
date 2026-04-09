import { useState, useRef, useEffect } from 'react'

const REFERENCE: { heading: string; entries: { name: string; desc: string; overloads: string[] }[] }[] = [
  {
    heading: 'Constructors',
    entries: [
      { name: 'pt', desc: 'Create a 2D point', overloads: ['(number, number)'] },
      { name: 'edge', desc: 'Create an edge between two points', overloads: ['(point, point)', '(x1, y1, x2, y2)'] },
      { name: 'rect', desc: 'Create a rectangle', overloads: ['(x, y, w, h)', '(point, w, h)', '(point, point)'] },
      { name: 'square', desc: 'Create a square', overloads: ['(x, y, size)'] },
      { name: 'polygon', desc: 'Regular polygon from center', overloads: ['(center, sides, radius)'] },
      { name: 'ExtrudeCurve', desc: 'Extrude an edge into a rectangle', overloads: ['(edge, length)', '(edge, length, direction)'] },
    ],
  },
  {
    heading: 'Transforms (methods on geometry)',
    entries: [
      { name: '.translate', desc: 'Translate by offset', overloads: ['(dx, dy)', '(point)'] },
      { name: '.translateX', desc: 'Translate along X', overloads: ['(dx)'] },
      { name: '.translateY', desc: 'Translate along Y', overloads: ['(dy)'] },
      { name: '.rotate', desc: 'Rotate in degrees', overloads: ['(deg)', '(center, deg)'] },
      { name: '.scale', desc: 'Uniform scale', overloads: ['(factor)', '(center, factor)'] },
      { name: '.mirror', desc: 'Mirror across a line', overloads: ['(edge)', '(point, point)'] },
      { name: '.move', desc: 'Translate from point A to B', overloads: ['(from, to)'] },
    ],
  },
  {
    heading: '3D Transforms',
    entries: [
      { name: '.translateZ', desc: 'Translate along Z', overloads: ['(dz)'] },
      { name: '.rotateX', desc: 'Rotate around X axis', overloads: ['(deg)'] },
      { name: '.rotateY', desc: 'Rotate around Y axis', overloads: ['(deg)'] },
      { name: '.rotateAxis', desc: 'Rotate around arbitrary axis', overloads: ['(edge3, deg)'] },
    ],
  },
  {
    heading: 'Boolean Operations',
    entries: [
      { name: 'union', desc: 'Boolean union of two shapes', overloads: ['(shape, shape)'] },
      { name: 'difference', desc: 'Subtract second shape from first', overloads: ['(shape, shape)'] },
      { name: 'intersection', desc: 'Intersect two shapes', overloads: ['(shape, shape)'] },
      { name: 'unionAll', desc: 'Union of many shapes', overloads: ['(shape, ...) or (array)'] },
    ],
  },
  {
    heading: '3D',
    entries: [
      { name: 'Extrude3D', desc: 'Extrude a shape along Z', overloads: ['(region|polygon|rect, height)'] },
      { name: 'Axis.X / .Y / .Z', desc: 'Unit axis edge constants', overloads: [] },
    ],
  },
  {
    heading: 'Lineage Queries',
    entries: [
      { name: 'query', desc: 'Filter array by lineage predicate', overloads: ['(array, predicate)'] },
      { name: 'from', desc: 'Reachable via direct lineage edges from all parents', overloads: ['(parent, ...)'] },
      { name: 'fromAny', desc: 'Reachable via direct lineage edges from any parent', overloads: ['(parent, ...)'] },
      { name: 'derivedFrom', desc: 'Reachable via all lineage edges (direct + indirect) from all parents', overloads: ['(parent, ...)'] },
      { name: 'derivedFromAny', desc: 'Reachable via all lineage edges (direct + indirect) from any parent', overloads: ['(parent, ...)'] },
      { name: 'contains', desc: 'Inner query matches a sub-element', overloads: ['(predicate)'] },
      { name: 'and / or / not', desc: 'Compose predicates', overloads: ['(q, q) / (q, q) / (q)'] },
    ],
  },
  {
    heading: 'Drawing',
    entries: [
      { name: 'draw', desc: 'Render intermediate geometry to viewport. Each call creates a draw batch; pass styles to set color/opacity. Edges in drawn batches are draggable.', overloads: ['(shape, ...styles)'] },
      { name: 'color', desc: 'Set fill and edge color for a draw batch', overloads: ['(string)'] },
      { name: 'stroke', desc: 'Set edge-only color (fill unchanged)', overloads: ['(string)'] },
      { name: 'translucent', desc: 'Set opacity for a draw batch', overloads: ['(number)'] },
      { name: 'dashed', desc: 'Keyword: draw edges as dashed lines, suppress polygon fills. Dashed edges are not draggable but vertices can still be locked.', overloads: [] },
    ],
  },
  {
    heading: 'Other',
    entries: [
      { name: 'tabulate', desc: 'Generate array via function', overloads: ['(n, fn)'] },
      { name: 'chamfer', desc: 'Chamfer polygon corners', overloads: ['(polygon, points, radius)'] },
      { name: 'single', desc: 'Assert array has one element', overloads: ['(array)'] },
      { name: 'empty', desc: 'Assert array is empty', overloads: ['(array)'] },
      { name: 'print', desc: 'Log values to console', overloads: ['(value, ...)'] },
    ],
  },
  {
    heading: 'Properties',
    entries: [
      { name: 'point2', desc: '.x .y', overloads: [] },
      { name: 'edge2', desc: '.start .end .midpoint .at(t)', overloads: [] },
      { name: 'rectangle', desc: '.x .y .width .height .top .bottom .left .right .topLeft .topRight .bottomLeft .bottomRight .points .edges', overloads: [] },
      { name: 'polygon', desc: '.points .edges', overloads: [] },
      { name: 'region', desc: '.positive .negative .points .edges .single()', overloads: [] },
      { name: 'extrusion', desc: '.bottomEdges .topEdges .verticalEdges .verticalFaces .bottomFace .topFace .edges .points', overloads: [] },
      { name: 'array', desc: '.length .single() .empty() .0 .1 ... (numeric properties for indexing)', overloads: [] },
    ],
  },
]

export function HelpButton() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="absolute bottom-3 right-3 z-20 w-7 h-7 rounded-full
          bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm font-bold
          flex items-center justify-center cursor-pointer select-none"
        title="Language reference"
      >
        ?
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute bottom-12 right-3 left-3 z-30
            max-h-[400px] overflow-y-auto
            bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl
            text-xs text-zinc-200 p-3"
        >
          <div className="text-zinc-500 text-[11px] mb-3 leading-4">
            All constructor functions are case-insensitive.
            Ctrl+S to run. Alt+click vertices to lock. Drag edges to optimize.
          </div>
          {REFERENCE.map((section) => (
            <div key={section.heading} className="mb-3 last:mb-0">
              <div className="text-zinc-400 font-semibold text-[11px] uppercase tracking-wide mb-1">
                {section.heading}
              </div>
              {section.entries.map((entry) => (
                <div key={entry.name} className="flex gap-2 leading-5">
                  <code className="text-amber-400 shrink-0">{entry.name}</code>
                  <span className="text-zinc-400">{entry.desc}</span>
                  {entry.overloads.length > 0 && (
                    <span className="text-zinc-500 ml-auto shrink-0">
                      {entry.overloads.join(' | ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
