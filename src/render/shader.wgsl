// Raycast compute shader.
// Each thread = one pixel. Generates a ray, traverses BVH, collects up to 10 hits,
// sorts by depth, composites front-to-back.

struct Camera {
  viewProj: mat4x4<f32>,        // view-projection matrix
  invViewProj: mat4x4<f32>,     // inverse view-projection
  eye: vec3<f32>,               // camera position
  isOrtho: f32,                 // 1.0 = orthographic, 0.0 = perspective
  width: f32,
  height: f32,
  _pad0: f32,
  _pad1: f32,
}

struct BVHNode {
  minB: vec3<f32>,
  leftOrStart: u32,
  maxB: vec3<f32>,
  rightOrCount: u32,
  // flags: bit 0 = isLeaf, bit 1 = primType (0=tri, 1=seg)
  flags: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
}

struct Triangle {
  v0: vec3<f32>, _p0: f32,
  v1: vec3<f32>, _p1: f32,
  v2: vec3<f32>, _p2: f32,
  color: vec4<f32>,
}

struct Segment {
  p0: vec3<f32>, _p0: f32,
  p1: vec3<f32>, _p1: f32,
  color: vec4<f32>,
  radius: f32,
  _sp0: f32, _sp1: f32, _sp2: f32,
}

struct Hit {
  t: f32,
  color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> nodes: array<BVHNode>;
@group(0) @binding(2) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(3) var<storage, read> segments: array<Segment>;
@group(0) @binding(4) var<storage, read> triIndices: array<u32>;
@group(0) @binding(5) var<storage, read> segIndices: array<u32>;
@group(0) @binding(6) var output: texture_storage_2d<rgba8unorm, write>;

fn generateRay(pixel: vec2<f32>) -> array<vec3<f32>, 2> {
  // NDC: pixel center mapped to [-1, 1]
  let ndc = vec2<f32>(
    (pixel.x + 0.5) / camera.width * 2.0 - 1.0,
    1.0 - (pixel.y + 0.5) / camera.height * 2.0,  // flip Y
  );

  if (camera.isOrtho > 0.5) {
    // Orthographic: origin on near plane, direction = forward
    let nearPt = camera.invViewProj * vec4<f32>(ndc, -1.0, 1.0);
    let farPt  = camera.invViewProj * vec4<f32>(ndc,  1.0, 1.0);
    let origin = nearPt.xyz / nearPt.w;
    let dest = farPt.xyz / farPt.w;
    let dir = normalize(dest - origin);
    return array<vec3<f32>, 2>(origin, dir);
  } else {
    // Perspective: origin = eye, direction through pixel
    let farPt = camera.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
    let dest = farPt.xyz / farPt.w;
    let dir = normalize(dest - camera.eye);
    return array<vec3<f32>, 2>(camera.eye, dir);
  }
}

fn rayAABB(origin: vec3<f32>, invDir: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> bool {
  let t1 = (bmin - origin) * invDir;
  let t2 = (bmax - origin) * invDir;
  let tmin = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
  let tmax = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
  return tmax >= max(tmin, 0.0);
}

fn rayTriangle(origin: vec3<f32>, dir: vec3<f32>, tri: Triangle) -> f32 {
  let e1 = tri.v1 - tri.v0;
  let e2 = tri.v2 - tri.v0;
  let h = cross(dir, e2);
  let a = dot(e1, h);
  if (abs(a) < 1e-7) { return -1.0; }
  let f = 1.0 / a;
  let s = origin - tri.v0;
  let u = f * dot(s, h);
  if (u < 0.0 || u > 1.0) { return -1.0; }
  let q = cross(s, e1);
  let v = f * dot(dir, q);
  if (v < 0.0 || u + v > 1.0) { return -1.0; }
  let t = f * dot(e2, q);
  if (t < 1e-4) { return -1.0; }
  return t;
}

fn raySegment(origin: vec3<f32>, dir: vec3<f32>, seg: Segment) -> f32 {
  // Analytical closest-approach between ray and line segment.
  let d = seg.p1 - seg.p0;
  let w = origin - seg.p0;

  let a_val = dot(dir, dir);    // always 1 if dir normalized, but be safe
  let b_val = dot(dir, d);
  let c_val = dot(d, d);
  let d_val = dot(dir, w);
  let e_val = dot(d, w);

  let denom = a_val * c_val - b_val * b_val;

  var s_ray: f32;
  var t_seg: f32;

  if (denom < 1e-7) {
    // Nearly parallel
    s_ray = 0.0;
    t_seg = d_val / b_val;
  } else {
    s_ray = (b_val * e_val - c_val * d_val) / denom;
    t_seg = (a_val * e_val - b_val * d_val) / denom;
  }

  // Clamp segment parameter to [0, 1]
  t_seg = clamp(t_seg, 0.0, 1.0);
  // Recompute ray parameter for clamped segment point
  s_ray = (dot(d * t_seg + seg.p0 - origin, dir)) / a_val;

  if (s_ray < 1e-4) { return -1.0; }

  let closestRay = origin + dir * s_ray;
  let closestSeg = seg.p0 + d * t_seg;
  let dist = length(closestRay - closestSeg);

  if (dist > seg.radius) { return -1.0; }
  return s_ray;
}

fn insertHit(hits: ptr<function, array<Hit, 10>>, count: ptr<function, u32>, t: f32, color: vec4<f32>) {
  let c = *count;

  // If full and farther than the farthest, skip
  if (c >= 10u && t >= (*hits)[9].t) { return; }

  // Find insertion point (sorted by t ascending)
  var pos = min(c, 9u);
  for (var i = 0u; i < min(c, 10u); i++) {
    if (t < (*hits)[i].t) {
      pos = i;
      break;
    }
  }

  // Shift elements right
  let limit = min(c, 9u);
  var j = limit;
  while (j > pos) {
    (*hits)[j] = (*hits)[j - 1u];
    j--;
  }

  (*hits)[pos] = Hit(t, color);
  *count = min(c + 1u, 10u);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let px = gid.x;
  let py = gid.y;
  if (px >= u32(camera.width) || py >= u32(camera.height)) { return; }

  let ray = generateRay(vec2<f32>(f32(px), f32(py)));
  let origin = ray[0];
  let dir = ray[1];
  let invDir = 1.0 / dir;

  var hits: array<Hit, 10>;
  var hitCount: u32 = 0u;

  // BVH traversal with explicit stack
  var stack: array<u32, 64>;
  var sp: u32 = 0u;
  stack[0] = 0u;
  sp = 1u;

  while (sp > 0u) {
    sp--;
    let ni = stack[sp];
    let node = nodes[ni];

    if (!rayAABB(origin, invDir, node.minB, node.maxB)) { continue; }

    let isLeaf = (node.flags & 1u) != 0u;

    if (isLeaf) {
      let primType = (node.flags >> 1u) & 1u;
      let start = node.leftOrStart;
      let count = node.rightOrCount;

      if (primType == 0u) {
        // Triangles
        for (var i = 0u; i < count; i++) {
          let ti = triIndices[start + i];
          let t = rayTriangle(origin, dir, triangles[ti]);
          if (t > 0.0) {
            insertHit(&hits, &hitCount, t, triangles[ti].color);
          }
        }
      } else {
        // Segments
        for (var i = 0u; i < count; i++) {
          let si = segIndices[start + i];
          let t = raySegment(origin, dir, segments[si]);
          if (t > 0.0) {
            insertHit(&hits, &hitCount, t, segments[si].color);
          }
        }
      }
    } else {
      // Push children — push far child first so near is popped first
      if (sp < 62u) {
        stack[sp] = node.leftOrStart;
        sp++;
        stack[sp] = node.rightOrCount;
        sp++;
      }
    }
  }

  // Composite front-to-back
  var color = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  for (var i = 0u; i < hitCount; i++) {
    let src = hits[i].color;
    let srcA = src.a;
    color = vec4<f32>(
      color.rgb + (1.0 - color.a) * srcA * src.rgb,
      color.a + (1.0 - color.a) * srcA,
    );
    if (color.a > 0.99) { break; }
  }

  // Blend with background #f0f0f0
  let bg = vec3<f32>(0.941, 0.941, 0.941);
  let final_rgb = color.rgb + (1.0 - color.a) * bg;

  textureStore(output, vec2<u32>(px, py), vec4<f32>(final_rgb, 1.0));
}
