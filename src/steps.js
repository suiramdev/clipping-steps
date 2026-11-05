// The walkthrough: one entry per step. `scene` tells the viewer what to show; the viewer runs the
// application's own clipping arithmetic (clip-core.js) to produce it.
import * as THREE from 'three'

const rot = normal => {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...normal).normalize())
  return [q.x, q.y, q.z, q.w]
}
const turn = euler => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler))
  return [q.x, q.y, q.z, q.w]
}
const plane = (center, normal) => ({ shape: 'plane', center, rotation: rot(normal), size: [0, 0, 0] })
const box = (center, size, euler = [0, 0, 0]) => ({ shape: 'box', center, rotation: turn(euler), size })
const sphere = (center, diameter) => ({ shape: 'sphere', center, rotation: [0, 0, 0, 1], size: [diameter, diameter, diameter] })

const GREEN = '<i class="sw" style="background:#12b76a"></i>'
const RED = '<i class="sw" style="background:#ef4444"></i>'
const YELLOW = '<i class="sw" style="background:#c6a53a"></i>'

export const STEPS = [
  {
    title: 'Start from a list of cutting shapes',
    where: 'Data',
    body: `<p>The user adds <b>planes</b>, <b>boxes</b> and <b>spheres</b>. Each one is only four values:
a shape, a center, a rotation and a size. All the next steps read this list. Nothing else is stored.</p>
<ul><li>A plane removes the side <b>behind</b> it (opposite to the arrow).</li>
<li>A box or a sphere removes its <b>inside</b>.</li></ul>
<p>Here nothing is cut yet: the shapes only float over the mesh.</p>`,
    math: 'element = { shape, center, rotation (quaternion), size }',
    legend: '<i class="sw" style="background:#167c85"></i> plane, arrow = kept side &nbsp; <i class="sw" style="background:#fe5b04"></i> box',
    scene: { model: 'bracket', elements: [plane([0, -0.45, 0], [0, 1, 0]), box([0.6, -0.55, 0.25], [0.6, 0.6, 0.6])], surface: 'full', normals: true, camera: [2.4, 1.9, 3.4] },
  },
  {
    title: 'Is a point removed? The plane test',
    where: 'Maths',
    body: `<p>Every decision starts with one number: the <b>signed distance</b> from a point to the plane.
Positive: the point is in front, it stays. Negative: it is behind, it goes.</p>
<p>The dots are the nodes of the mesh, coloured by that sign while the plane turns.</p>`,
    math: `n = rotation · (0, 1, 0)
c = −n · center
d(x) = n · x + c
d(x) &lt; 0  ⇒  x is removed`,
    legend: `${GREEN} d &gt; 0 kept &nbsp; ${RED} d &lt; 0 removed &nbsp; ${YELLOW} on the plane`,
    scene: {
      model: 'bracket', elements: [plane([-0.3, -0.35, 0], [0, 1, 0])], ghost: true, nodes: true, normals: true, camera: [2.8, 1.3, 3.2],
      anim: (t, s) => {
        const a = Math.sin(t * 0.8) * 0.75
        s.update(0, { rotation: rot([Math.sin(a), Math.cos(a), 0.3 * Math.sin(t * 0.5)]) })
      },
    },
  },
  {
    title: 'Is a point removed? The box and sphere test',
    where: 'Maths',
    body: `<p>A box can be anywhere, any size, turned any way. Instead of testing that box, the app moves
the <b>point</b> into the space where the box is the standard cube from −1 to 1 (a sphere becomes the
standard ball of radius 1). Then the test is trivial.</p>
<p>One matrix holds the whole box. When the user moves, turns or resizes it, only the matrix changes.</p>`,
    math: `M  = Translate(center) · Rotate(q) · Scale(size / 2)
x′ = M⁻¹ · x
box removes x     ⇔  max(|x′|, |y′|, |z′|) &lt; 1
sphere removes x  ⇔  ‖x′‖ &lt; 1`,
    legend: `${GREEN} kept &nbsp; ${RED} inside a volume: removed`,
    scene: {
      model: 'bracket', elements: [box([0.35, -0.6, 0.15], [0.6, 0.6, 0.6]), sphere([-0.8, 0.45, 0.2], 0.7)], ghost: true, nodes: true, camera: [2.4, 1.9, 3.4],
      anim: (t, s) => s.update(0, { rotation: turn([0.25 * Math.sin(t * 0.6), t * 0.4, 0]) }),
    },
  },
  {
    title: 'Several shapes: removed if any shape removes it',
    where: 'Maths',
    body: `<p>With several shapes, a point is removed as soon as <b>one</b> shape removes it.
What stays is the part that <b>every</b> shape keeps.</p>
<p>Two planes through the corner of the L therefore keep only the part both keep. A plane and a box keep the plane's
side, minus the inside of the box.</p>`,
    math: `removed(x) = removed₁(x)  OR  removed₂(x)  OR  …
kept       = kept₁  ∩  kept₂  ∩  …`,
    legend: `${GREEN} kept by every shape &nbsp; ${RED} removed by at least one`,
    scene: { model: 'bracket', elements: [plane([0, -0.45, 0], [0, 1, 0]), plane([-0.75, 0, 0], [1, 0, 0])], ghost: true, nodes: true, normals: true, camera: [2.4, 1.9, 3.4] },
  },
  {
    title: 'Hide the removed pixels on the graphics card',
    where: 'GPU, every frame',
    body: `<p>The mesh itself is never changed. When the graphics card draws a pixel of the surface, it runs
the test of steps 2 to 4 for that pixel and throws it away (<code>discard</code>) if it is removed.</p>
<p>Watch the box slide: nothing is recomputed on the CPU, only one matrix is sent to the card.</p>`,
    math: 'for each pixel at world position x:  if removed(x)  discard',
    trick: `<ul>
<li><b>Planes</b>: three.js does it already. The planes go in <code>material.clippingPlanes</code>, no custom code.</li>
<li><b>Boxes and spheres</b>: three.js has no volume clipping. The app injects a few lines into every material's
shader with <code>onBeforeCompile</code>, right after three.js' own clipping code: the vertex shader passes the world
position, the fragment shader loops over the volume matrices and discards.</li>
<li>All materials share <b>one uniform array</b> of matrices. Moving a box rewrites that array: no shader recompiles.</li>
<li>The test uses <b>1 + 0.0001</b> instead of 1, so a box face flush with a mesh face is removed cleanly instead of flickering.</li></ul>`,
    scene: {
      model: 'bracket', elements: [plane([0, -0.75, 0], [0.05, 1, 0]), box([0, -0.4, 0.3], [0.55, 0.55, 0.55])], surface: 'hollow', normals: true, camera: [2.4, 1.9, 3.4],
      anim: (t, s) => s.update(1, { center: [0.85 * Math.sin(t * 0.7), -0.4, 0.3] }),
    },
  },
  {
    title: 'Problem: the cut is hollow',
    where: 'Why a cap',
    body: `<p>The surface is only a skin of triangles; the inside is empty. Once pixels are hidden, you look
<b>into the skin</b>: you see the far inner walls, not the material at the cut.</p>
<p>A real face must close the cut. This face is the <b>cap</b>. Steps 7 to 15 build it.</p>`,
    scene: { model: 'bracket', elements: [plane([0, 0, 0.05], [-0.15, -0.1, -1])], surface: 'hollow', camera: [1.9, 1.3, 2.9] },
  },
  {
    title: 'Find the tetrahedra the plane crosses',
    where: 'Background thread',
    body: `<p>Inside, the mesh is made of <b>tetrahedra</b> (small solids with 4 corners). For each one, compute
the signed distance <i>d</i> of its 4 corners:</p>
<ul><li>all positive: kept whole, no cap;</li><li>all negative: removed whole, no cap;</li>
<li>mixed: the plane crosses it (yellow). Only these make the cap.</li></ul>`,
    math: `kept corners = count of d &gt; 0.000001
crossed ⇔ kept corners is 1, 2 or 3`,
    trick: `<ul><li>A corner exactly <b>on</b> the plane counts as removed. A mesh face lying on the plane then gives one cap face, not two identical ones that would flicker.</li>
<li>The tetrahedra are pre-sorted in layers along the plane direction, so a plane dragged along its normal only reads its own layer.</li></ul>`,
    legend: `${YELLOW} tetrahedra crossed by the plane`,
    scene: {
      model: 'bracket', elements: [plane([-0.3, -0.35, 0], [0.3, 1, 0.2])], ghost: true, cutTets: true, normals: true, camera: [2.4, 1.9, 3.4],
      anim: (t, s) => s.update(0, { center: [-0.3, -0.35 + 0.5 * Math.sin(t * 0.6), 0] }),
    },
  },
  {
    title: 'Cut one tetrahedron',
    where: 'Background thread',
    body: `<p>Zoom on one crossed tetrahedron. On each of its 6 edges whose two ends have opposite signs, the plane
passes at the point where <i>d</i> goes through zero. Since <i>d</i> changes linearly along the edge, that point is
a simple linear interpolation.</p>
<p>One corner alone on its side gives <b>3 points</b> (a triangle). Two and two gives <b>4 points</b> (a quadrilateral), as here.</p>`,
    math: `t = dA / (dA − dB)
point = pA + t · (pB − pA)`,
    legend: `${GREEN} corner kept &nbsp; ${RED} corner removed &nbsp; <i class="sw" style="background:#ff8141"></i> crossed edge &nbsp; ${YELLOW} crossing point`,
    scene: { model: 'bracket', elements: [plane([-0.3, -0.37, 0.03], [0.35, 1, 0.25])], focus: 'distances', camera: [2.4, 1.9, 3.4] },
  },
  {
    title: 'Order the points and split into triangles',
    where: 'Background thread',
    body: `<p>The points come out in edge order, which is not a polygon. They are sorted by <b>angle</b> around
their center, measured in two directions lying in the plane.</p>
<p>The cut of a tetrahedron is always <b>convex</b>, so it is then split into triangles from its first point (a <b>fan</b>).</p>`,
    math: `c = average of the points
a, b = two directions in the plane
θ = atan2( b · (v − c), a · (v − c) )
sort by θ, then triangles (0, 2, 1), (0, 3, 2), …`,
    legend: '<i class="sw" style="background:#0b6e77"></i> sorted polygon &nbsp; coloured: fan triangles',
    scene: { model: 'bracket', elements: [plane([-0.3, -0.37, 0.03], [0.35, 1, 0.25])], focus: 'polygon', camera: [2.4, 1.9, 3.4] },
  },
  {
    title: 'All the small pieces make the cap',
    where: 'Background thread',
    body: `<p>Every crossed tetrahedron gives its own small polygon. Put together, they are the cap.</p>
<p>Two neighbours share an edge, and both compute the crossing on that edge from the <b>same two corners</b>,
so their pieces meet exactly: the cap has no gaps, even on a concave part with a hole like this bracket.</p>`,
    legend: 'one colour per tetrahedron &nbsp; <i class="sw" style="background:#1c242a"></i> tetrahedron being added',
    scene: {
      model: 'bracket', elements: [plane([0, 0, 0.05], [-0.15, -0.1, -1])], surface: 'clipped', cap: 'tet', capWire: true, camera: [0.6, 0.9, 3.2],
      anim: (t, s) => s.setBuild(Math.min(1, (t % 8) / 6)),
    },
  },
  {
    title: 'Colour the cap with the simulation result',
    where: 'Background thread, then main thread',
    body: `<p>The simulation gives one value at each corner of each tetrahedron. Every cap point remembers
<b>4 weights</b>, one per corner of its tetrahedron (on a crossed edge: 1 − t and t). Its value is the weighted average.</p>
<p>When the result changes (here, playing frames), the cap is <b>not rebuilt</b>: the same weights are
applied to the new values.</p>`,
    math: `value = w₀·f₀ + w₁·f₁ + w₂·f₂ + w₃·f₃
with w₀ + w₁ + w₂ + w₃ = 1
exact: the result is linear in a tetrahedron`,
    scene: {
      model: 'bracket', elements: [plane([-0.3, -0.4, 0], [-0.2, -1, -0.15]), sphere([0.3, -0.75, 0.3], 0.5)], surface: 'clipped', cap: 'field', camera: [2.3, 2.7, 3.0],
      anim: (t, s) => s.setPhase(t * 0.9),
    },
  },
  {
    title: 'Several planes: trim each cap by the others',
    where: 'Background thread',
    body: `<p>With two planes, each cap must stop where the other plane starts removing. Each small polygon is
cut by every other plane, one plane at a time (<b>Sutherland–Hodgman</b>): keep the corners on the kept side,
and add the crossing point on each side of the polygon that changes side.</p>
<p>A tetrahedron fully behind another plane is skipped before any polygon is made.</p>`,
    math: 'for each other plane:  keep corners with d ≥ 0,  add the point at t = d₁ / (d₁ − d₂) on each changing side',
    legend: 'one colour per plane cap',
    scene: { model: 'bracket', elements: [plane([0, 0, 0.1], [0.05, 0.1, -1]), plane([0.4, 0, 0], [-1, 0.1, 0.15])], surface: 'clipped', cap: 'section', capWire: true, normals: true, camera: [2.4, 1.9, 3.4] },
  },
  {
    title: 'A box is six planes',
    where: 'Background thread',
    body: `<p>For the cap, a box is cut into <b>six flat cuts</b>, one per face. Each face cap keeps only the part
inside the other five faces. It is the plane method of steps 7 to 12, six times.</p>`,
    math: 'face i: plane of face i,  trimmed by the inside of the 5 other faces',
    legend: 'one colour per face cap &nbsp; arrows: outward face normals',
    scene: { model: 'bracket', elements: [box([-0.4, -0.25, 0.25], [0.8, 0.8, 0.8], [0.15, 0.4, 0])], surface: 'clipped', cap: 'section', capWire: true, normals: true, camera: [2.4, 1.9, 3.4] },
  },
  {
    title: 'A sphere: a fine ball cut by each tetrahedron',
    where: 'Background thread',
    body: `<p>A sphere is curved: there is no straight edge crossing to interpolate. The app works the other way round.
It takes a fine ball of <b>20 480 small triangles</b>, and for each tetrahedron that touches the sphere surface,
keeps the pieces of those triangles that lie inside the tetrahedron (cut by its 4 faces).</p>
<p>Two neighbour tetrahedra cut with the same shared face, so their pieces meet with no gap.</p>`,
    math: `weights of a point x:  (w₁, w₂, w₃) = A⁻¹ · (x − p₀),   w₀ = 1 − w₁ − w₂ − w₃
A = [ p₁ − p₀,  p₂ − p₀,  p₃ − p₀ ]`,
    legend: 'one colour per tetrahedron',
    scene: { model: 'bracket', elements: [sphere([-0.5, -0.4, 0.3], 0.9)], surface: 'clipped', cap: 'tet', camera: [2.4, 1.9, 3.4] },
  },
  {
    title: 'Caps and the other volumes',
    where: 'GPU and background thread',
    body: `<p>A box cap lies exactly <b>on</b> its own box, and step 5 removes the box boundary too. Cut by every
volume, a cap would erase itself.</p>
<ul><li>Each cap point stores its <b>owner</b>: the volume it lies on. The cap shader skips its owner and still tests every other volume.</li>
<li>A cap triangle with its 3 corners inside another volume is dropped before drawing: a box and a ball are convex, so the whole triangle is inside.</li>
<li>Two identical volumes share one owner, so their caps do not erase each other.</li></ul>`,
    trick: 'One extra vertex attribute (<code>owner</code>) on the cap, and one <code>continue</code> in the shader loop of step 5.',
    legend: '<i class="sw" style="background:#fe5b04"></i> cap owned by the box &nbsp; <i class="sw" style="background:#3b82f6"></i> cap owned by the sphere',
    scene: { model: 'bracket', elements: [box([-0.4, -0.3, 0.3], [0.7, 0.7, 0.7]), sphere([-0.75, 0.2, 0.3], 0.8)], surface: 'clipped', cap: 'owner', camera: [2.4, 1.9, 3.4] },
  },
  {
    title: 'Draw the red outline',
    where: 'Main thread',
    body: `<p>The red line shows where each shape meets the surface. It is computed triangle by triangle on the surface:</p>
<ul><li><b>Plane</b>: the two edge crossings of the triangle, joined.</li>
<li><b>Box</b>: the line of each face on the triangle, trimmed to the box (<b>Liang–Barsky</b>).</li>
<li><b>Sphere</b>: the sphere meets the triangle's plane in a circle, drawn as 96 short segments trimmed to the triangle.</li></ul>
<p>A segment whose middle is removed by another shape is dropped.</p>`,
    math: `circle center = c − (n · (c − a)) n
circle radius = √(r² − d²)     d = n · (c − a)`,
    legend: '<i class="sw" style="background:#dc2626"></i> outline',
    scene: { model: 'bracket', elements: [plane([0, -0.8, 0], [0.1, 1, 0.3]), box([0.6, -0.5, 0.4], [0.6, 0.6, 0.6]), sphere([-0.8, 0.4, 0.35], 0.7)], surface: 'clipped', cap: 'field', outline: true, camera: [2.4, 1.9, 3.4] },
  },
  {
    title: 'Everything together',
    where: 'Summary',
    body: `<ol><li><b>GPU, every frame</b>: hide the removed pixels (steps 2 to 5).</li>
<li><b>Background thread (Web Worker), once per change</b>: build the cap from the tetrahedra and colour it (steps 7 to 15).</li>
<li><b>Main thread</b>: draw the outline (step 16).</li></ol>
<p>During a drag, the cap can be one build late. The hole then uses the shapes of the <b>last finished cap</b>,
so hole and cap always match. A click in the 3D view repeats the removal test on the CPU, so it never picks a hidden triangle.</p>`,
    scene: { model: 'bracket', elements: [plane([0, 0, 0.05], [-0.2, -0.1, -1]), sphere([-0.75, 0.45, -0.1], 0.75)], surface: 'clipped', cap: 'field', outline: true, autoRotate: true, camera: [1.7, 1.5, 3.6] },
  },
]
