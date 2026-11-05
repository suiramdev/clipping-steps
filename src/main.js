import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import * as C from './clip-core.js'
import { buildModel } from './mesh.js'
import { STEPS } from './steps.js'

const $ = id => document.getElementById(id)

// ---------------------------------------------------------------------------------------------
// Colour map (turbo), read per fragment through a 256 x 1 texture
// ---------------------------------------------------------------------------------------------
function turbo(t) {
  t = Math.min(1, Math.max(0, t))
  const r = 0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))))
  const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))))
  const b = 0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))))
  return [r, g, b].map(v => Math.min(1, Math.max(0, v)))
}
const lutData = new Uint8Array(256 * 4)
for (let i = 0; i < 256; i++) lutData.set([...turbo(i / 255).map(v => v * 255), 255], i * 4)
const lut = new THREE.DataTexture(lutData, 256, 1)
lut.colorSpace = THREE.SRGBColorSpace
lut.magFilter = lut.minFilter = THREE.LinearFilter
lut.needsUpdate = true
$('colorbar').style.background = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(t => `rgb(${turbo(t).map(v => Math.round(v * 255)).join(',')})`).join(',')})`

const RANGE = [-1.05, 1.05]
const uvOf = value => (0.5 + Math.min(1, Math.max(0, (value - RANGE[0]) / (RANGE[1] - RANGE[0]))) * 255) / 256
const field = (x, y, z, p) => 0.55 * Math.sin(2.1 * x + 0.5 + p) * Math.cos(1.7 * z) + 0.45 * y + 0.18 * Math.sin(4 * y + x - p)

// ---------------------------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------------------------
const view = $('view')
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.localClippingEnabled = true
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0xf6f9f9, 1)
view.prepend(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100)
scene.add(camera)
scene.add(new THREE.HemisphereLight(0xffffff, 0xc7d1d4, 1.8))
const key = new THREE.DirectionalLight(0xffffff, 1.7)
key.position.set(1.5, 2, 1)
camera.add(key)
const orbit = new OrbitControls(camera, renderer.domElement)
orbit.enableDamping = true
orbit.autoRotateSpeed = 0.8

// The clipping state every patched material reads (as the app's shared uniform block).
const uniforms = C.createClipVolumeUniforms()
const planePool = Array.from({ length: C.MAX_DEMO_PLANES }, () => new THREE.Plane())
const planes = []

const litMaterial = (options, isCap = false) => {
  const material = new THREE.MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...options })
  material.clippingPlanes = isCap ? [] : planes
  return C.patchClipVolumes(material, uniforms, isCap)
}
const MATERIALS = {
  full: new THREE.MeshLambertMaterial({ map: lut }),
  clipped: litMaterial({ map: lut }),
  hollow: litMaterial({ map: lut, side: THREE.DoubleSide }),
  capField: litMaterial({ map: lut }, true),
  capColor: litMaterial({ vertexColors: true }, true),
}
const overlay = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false })

const empty = new THREE.BufferGeometry()
const surface = new THREE.Mesh(empty, MATERIALS.full)
const cap = new THREE.Mesh(empty, MATERIALS.capField)
cap.renderOrder = 1
const capWireMaterial = C.patchClipVolumes(new THREE.LineBasicMaterial({ color: 0x1c242a, transparent: true, opacity: 0.55 }), uniforms, true)
const capWire = new THREE.LineSegments(empty, capWireMaterial)
capWire.renderOrder = 10
const ghost = new THREE.Mesh(empty, new THREE.MeshBasicMaterial({ color: 0x9eadb3, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }))
const ghostEdges = new THREE.LineSegments(empty, overlay(0x6c7b83, 0.35))
const nodes = new THREE.Points(empty, new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }))
nodes.renderOrder = 20
const cutTets = new THREE.LineSegments(empty, overlay(0xc6a53a, 0.7))
cutTets.renderOrder = 15
const outline = new THREE.LineSegments(empty, new THREE.LineBasicMaterial({ color: 0xdc2626 }))
outline.renderOrder = 30
const shapes = new THREE.Group()
const arrows = new THREE.Group()
const focus = new THREE.Group()
const scan = new THREE.Group()
scene.add(surface, cap, capWire, ghost, ghostEdges, nodes, cutTets, outline, shapes, arrows, focus, scan)

// ---------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------
let model = null
let modelScale = 1
const modelCenter = new THREE.Vector3()
let nodal = null

function loadModel(key) {
  if (model?.key === key) return
  model = buildModel(key)
  model.bounds.getCenter(modelCenter)
  modelScale = model.bounds.getSize(new THREE.Vector3()).length()
  const { positions, surface: tris } = model
  const flat = new Float32Array(tris.length * 3)
  for (let i = 0; i < tris.length; i++) flat.set(positions.subarray(tris[i] * 3, tris[i] * 3 + 3), i * 3)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(flat, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tris.length * 2), 2))
  g.computeVertexNormals()
  surface.geometry = ghost.geometry = g
  ghostEdges.geometry = new THREE.EdgesGeometry(g, 25)
  const n = new THREE.BufferGeometry()
  n.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  n.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3))
  nodes.geometry = n
  nodal = new Float32Array(positions.length / 3)
}

function setPhaseValues(phase) {
  const { positions, surface: tris } = model
  for (let i = 0; i < nodal.length; i++) nodal[i] = field(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], phase)
  const uv = surface.geometry.getAttribute('uv')
  for (let i = 0; i < tris.length; i++) uv.setXY(i, uvOf(nodal[tris[i]]), 0.5)
  uv.needsUpdate = true
}

// ---------------------------------------------------------------------------------------------
// Step state
// ---------------------------------------------------------------------------------------------
let step = null
let elements = []
let capParts = null
let focusTet = -1
let enteredAt = 0
let dirty = false
let phase = 0

function writeGpu() {
  C.writeClipVolumes(uniforms, elements)
  planes.length = 0
  elements.filter(e => e.shape === 'plane').forEach((e, i) => planes.push(C.writeClippingPlane(e, planePool[i])))
}

const SHAPE_COLORS = { plane: 0x167c85, box: 0xfe5b04, sphere: 0x3b82f6 }
function refreshShapes() {
  shapes.clear()
  for (const element of elements) {
    const color = SHAPE_COLORS[element.shape]
    const group = new THREE.Group()
    group.position.fromArray(element.center)
    group.quaternion.fromArray(element.rotation)
    const fill = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })
    const edge = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
    if (element.shape === 'plane') {
      const g = new THREE.PlaneGeometry(modelScale * 0.7, modelScale * 0.7).rotateX(-Math.PI / 2)
      group.add(new THREE.Mesh(g, fill), new THREE.LineSegments(new THREE.EdgesGeometry(g), edge))
    } else if (element.shape === 'box') {
      const g = new THREE.BoxGeometry(...element.size)
      group.add(new THREE.Mesh(g, fill), new THREE.LineSegments(new THREE.EdgesGeometry(g), edge))
    } else {
      const r = element.size[0] / 2
      group.add(new THREE.Mesh(new THREE.SphereGeometry(r, 40, 20), fill))
      for (const axis of [0, 1, 2]) {
        const pts = Array.from({ length: 65 }, (_, i) => {
          const a = (i / 64) * Math.PI * 2
          const p = [Math.cos(a) * r, Math.sin(a) * r]
          return axis === 0 ? new THREE.Vector3(0, p[0], p[1]) : axis === 1 ? new THREE.Vector3(p[0], 0, p[1]) : new THREE.Vector3(p[0], p[1], 0)
        })
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edge))
      }
    }
    shapes.add(group)
  }
}

function arrow(origin, direction, length, color) {
  const helper = new THREE.ArrowHelper(direction.clone().normalize(), origin, length, color, length * 0.28, length * 0.16)
  helper.traverse(o => {
    if (o.material) Object.assign(o.material, { depthTest: false, transparent: true })
    o.renderOrder = 40
  })
  return helper
}

function refreshArrows() {
  arrows.clear()
  if (!step.scene.normals) return
  for (const element of elements) {
    if (element.shape === 'plane') arrows.add(arrow(new THREE.Vector3(...element.center), C.writeClippingPlane(element).normal, 0.35, SHAPE_COLORS.plane))
    if (element.shape === 'box') {
      const center = new THREE.Vector3(...element.center)
      for (const face of C.clippingBoxFacePlanes(element)) arrows.add(arrow(center.clone().addScaledVector(face.normal, -face.distanceToPoint(center)), face.normal, 0.2, SHAPE_COLORS.box))
    }
  }
}

const tmp = new THREE.Color()
function refreshNodes() {
  nodes.visible = !!step.scene.nodes
  if (!nodes.visible) return
  const colors = nodes.geometry.getAttribute('color')
  const p = new THREE.Vector3()
  const single = elements.length === 1 && elements[0].shape === 'plane' ? C.writeClippingPlane(elements[0]) : null
  for (let i = 0; i < nodal.length; i++) {
    p.fromArray(model.positions, i * 3)
    let hex
    if (single) {
      const d = single.distanceToPoint(p)
      hex = d > C.SECTION_EPS ? 0x12b76a : d < -C.SECTION_EPS ? 0xef4444 : 0xc6a53a
    } else hex = elements.some(e => C.clippingElementRemoves(e, p)) ? 0xef4444 : 0x12b76a
    tmp.set(hex)
    colors.setXYZ(i, tmp.r, tmp.g, tmp.b)
  }
  colors.needsUpdate = true
}

const firstSection = () => C.clippingCapRecipe(elements).sections[0]

function crossedTets(section) {
  const { positions, indices } = model
  const { normal: n, constant } = section.plane
  const out = []
  for (let tet = 0; tet < indices.length / 4; tet++) {
    let kept = 0
    for (let c = 0; c < 4; c++) {
      const node = indices[tet * 4 + c] * 3
      if (n.x * positions[node] + n.y * positions[node + 1] + n.z * positions[node + 2] + constant > C.SECTION_EPS) kept++
    }
    if (kept > 0 && kept < 4) out.push({ tet, kept })
  }
  return out
}

function tetEdges(tets) {
  const { positions, indices } = model
  const pts = []
  for (const tet of tets) for (let e = 0; e < 6; e++) for (const c of [C.EDGE_A[e], C.EDGE_B[e]]) pts.push(new THREE.Vector3().fromArray(positions, indices[tet * 4 + c] * 3))
  return new THREE.BufferGeometry().setFromPoints(pts)
}

function refreshCutTets() {
  cutTets.visible = !!step.scene.cutTets
  if (cutTets.visible) cutTets.geometry = tetEdges(crossedTets(firstSection()).map(entry => entry.tet))
}

function refreshOutline() {
  outline.visible = !!step.scene.outline
  if (!outline.visible) return
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(C.outlineSegmentsOf(elements, model.positions, model.surface), 3))
  outline.geometry = g
}

// ---------------------------------------------------------------------------------------------
// The cap: the app's recipe and builders
// ---------------------------------------------------------------------------------------------
const OWNER_COLORS = [0xfe5b04, 0x3b82f6, 0x12b76a, 0xc6a53a]
const SECTION_COLORS = [0xfe5b04, 0x167c85, 0x3b82f6, 0xc6a53a, 0x084f57, 0xff8141]

function buildCap() {
  const mode = step.scene.cap
  cap.visible = capWire.visible = false
  if (!mode) return
  const recipe = C.clippingCapRecipe(elements)
  capParts = C.buildRecipeCapParts(model.positions, model.indices, recipe).parts
  const parts = capParts
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(parts.positions, 3))
  g.setIndex(new THREE.BufferAttribute(parts.indices, 1))
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((parts.positions.length / 3) * 2), 2))
  g.setAttribute(C.CLIP_OWNER_ATTRIBUTE, new THREE.BufferAttribute(parts.vertexOwners, 1))
  const colors = new Float32Array(parts.positions.length)
  for (let f = 0; f < parts.indices.length / 3; f++) {
    for (let k = 0; k < 3; k++) {
      const v = parts.indices[f * 3 + k]
      if (mode === 'tet') tmp.setHSL((parts.vertexTets[v] * 0.6180339) % 1, 0.55, 0.55)
      else if (mode === 'section') tmp.set(SECTION_COLORS[parts.faceSections[f] % SECTION_COLORS.length])
      else if (mode === 'owner') tmp.set(parts.vertexOwners[v] < 0 ? 0x167c85 : OWNER_COLORS[parts.vertexOwners[v] % OWNER_COLORS.length])
      colors.set([tmp.r, tmp.g, tmp.b], v * 3)
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g.computeVertexNormals()
  cap.geometry = g
  cap.material = mode === 'field' ? MATERIALS.capField : MATERIALS.capColor
  cap.visible = true
  recolourCap()

  capWire.visible = !!step.scene.capWire
  if (capWire.visible) {
    const faces = parts.indices.length / 3
    const lines = new Float32Array(faces * 18)
    const owners = new Float32Array(faces * 6)
    for (let f = 0; f < faces; f++) {
      for (let e = 0; e < 3; e++) {
        const a = parts.indices[f * 3 + e]
        const b = parts.indices[f * 3 + ((e + 1) % 3)]
        lines.set(parts.positions.subarray(a * 3, a * 3 + 3), (f * 6 + e * 2) * 3)
        lines.set(parts.positions.subarray(b * 3, b * 3 + 3), (f * 6 + e * 2 + 1) * 3)
        owners[f * 6 + e * 2] = parts.vertexOwners[a]
        owners[f * 6 + e * 2 + 1] = parts.vertexOwners[b]
      }
    }
    const w = new THREE.BufferGeometry()
    w.setAttribute('position', new THREE.BufferAttribute(lines, 3))
    w.setAttribute(C.CLIP_OWNER_ATTRIBUTE, new THREE.BufferAttribute(owners, 1))
    capWire.geometry = w
  }
}

/** The same weights, new nodal values: what the app does when the result frame changes. */
function recolourCap() {
  if (!capParts || !cap.visible) return
  const values = C.interpolateCapValues(capParts, model.indices, nodal)
  const uv = cap.geometry.getAttribute('uv')
  for (let v = 0; v < values.length; v++) uv.setXY(v, uvOf(values[v]), 0.5)
  uv.needsUpdate = true
}

function setBuild(fraction) {
  if (!capParts) return
  const faces = capParts.indices.length / 3
  const shown = Math.round(faces * fraction)
  cap.geometry.setDrawRange(0, shown * 3)
  capWire.geometry.setDrawRange(0, shown * 6)
  scan.clear()
  if (fraction < 1 && shown > 0) {
    const tet = capParts.capFaceTetrahedronIndices[shown - 1]
    const lines = new THREE.LineSegments(tetEdges([tet]), overlay(0x1c242a))
    lines.renderOrder = 50
    scan.add(lines)
  }
}

// ---------------------------------------------------------------------------------------------
// One tetrahedron, zoomed (steps 8 and 9)
// ---------------------------------------------------------------------------------------------
let labels = []
const addLabel = (p, html, cls = '') => labels.push({ p: new THREE.Vector3(...p), html, cls })
const fmt = v => (Math.abs(v) < 5e-7 ? '0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(3))

function dot(p, color, r) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }))
  m.position.set(...p)
  m.renderOrder = 60
  return m
}

function pickFocusTet() {
  const section = firstSection()
  const { normal: n, constant } = section.plane
  const nv = new THREE.Vector3(n.x, n.y, n.z)
  const reference = modelCenter.clone().addScaledVector(nv, -(nv.dot(modelCenter) + constant))
  const centroid = tet => {
    const c = new THREE.Vector3()
    for (let k = 0; k < 4; k++) c.add(new THREE.Vector3().fromArray(model.positions, model.indices[tet * 4 + k] * 3))
    return c.multiplyScalar(0.25)
  }
  const list = crossedTets(section).map(e => ({ ...e, d: centroid(e.tet).distanceTo(reference), c: centroid(e.tet) })).sort((a, b) => a.d - b.d)
  const pick = list.find(e => e.kept === 2) ?? list[0]
  return pick ? { tet: pick.tet, centroid: pick.c } : null
}

function refreshFocus() {
  focus.clear()
  labels = []
  const mode = step.scene.focus
  if (!mode || focusTet < 0) return
  const section = firstSection()
  const trace = C.traceSectionTet(model.positions, model.indices, section, focusTet)
  const r = modelScale * 0.0022
  const crossing = new Set(trace.crossings.map(x => x.edge))
  for (let e = 0; e < 6; e++) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...trace.corners[C.EDGE_A[e]]), new THREE.Vector3(...trace.corners[C.EDGE_B[e]])])
    const crossed = mode === 'distances' && crossing.has(e)
    const line = new THREE.Line(g, overlay(crossed ? 0xff8141 : 0x1c242a, mode === 'polygon' ? 0.45 : 0.9))
    line.renderOrder = 55
    focus.add(line)
  }
  // The cutting plane, as a small square around the tetrahedron.
  const n = new THREE.Vector3(section.plane.normal.x, section.plane.normal.y, section.plane.normal.z)
  const c = new THREE.Vector3(...trace.corners.reduce((s, p) => s.map((v, k) => v + p[k] / 4), [0, 0, 0]))
  const onPlane = c.clone().addScaledVector(n, -(n.dot(c) + section.plane.constant))
  const square = new THREE.Mesh(new THREE.PlaneGeometry(modelScale * 0.13, modelScale * 0.13), new THREE.MeshBasicMaterial({ color: 0x167c85, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }))
  square.position.copy(onPlane)
  square.lookAt(onPlane.clone().add(n))
  focus.add(square)

  if (mode === 'distances') {
    trace.corners.forEach((p, k) => {
      const d = trace.d[k]
      const cls = d > C.SECTION_EPS ? 'kept' : d < -C.SECTION_EPS ? 'removed' : 'on'
      focus.add(dot(p, { kept: 0x12b76a, removed: 0xef4444, on: 0xc6a53a }[cls], r))
      addLabel(p, `p${k}  d = ${fmt(d)}`, cls)
    })
    for (const x of trace.crossings) {
      focus.add(dot(x.point, 0xc6a53a, r * 1.1))
      addLabel(x.point, `t = ${x.t.toFixed(2)}`, 'on')
    }
    return
  }
  // polygon: the sorted loop, its centre and the fan, coloured by triangle
  const pts = trace.sorted.map(v => v.p)
  const loop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([...pts, pts[0]].map(p => new THREE.Vector3(...p))), overlay(0x0b6e77))
  loop.renderOrder = 58
  focus.add(loop)
  focus.add(dot(trace.centroid, 0x1c242a, r * 0.8))
  addLabel(trace.centroid, 'center c', '')
  trace.sorted.forEach((v, i) => addLabel(v.p, `${i}   θ = ${((trace.angles[trace.order[i]] * 180) / Math.PI).toFixed(0)}°`, 'poly'))
  const positions = []
  const colors = []
  trace.fan.forEach((tri, i) => {
    tmp.set(SECTION_COLORS[i % SECTION_COLORS.length])
    for (const k of tri) {
      positions.push(...trace.final[k].p)
      colors.push(tmp.r, tmp.g, tmp.b)
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const fan = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.75, depthTest: false }))
  fan.renderOrder = 57
  focus.add(fan)
}

// ---------------------------------------------------------------------------------------------
// Entering a step, updating while it animates
// ---------------------------------------------------------------------------------------------
function refreshAll() {
  writeGpu()
  refreshShapes()
  refreshArrows()
  refreshNodes()
  refreshCutTets()
  buildCap()
  refreshOutline()
  refreshFocus()
}

const ctx = {
  update: (index, patch) => {
    elements[index] = { ...elements[index], ...patch }
    dirty = true
  },
  setBuild,
  setPhase: p => {
    phase = p
    setPhaseValues(phase)
    recolourCap()
  },
}

function enter(index) {
  index = Math.max(0, Math.min(STEPS.length - 1, index))
  step = { ...STEPS[index], index }
  const s = step.scene
  loadModel(s.model)
  elements = s.elements.map((e, i) => ({ id: `e${i}`, ...e }))
  phase = 0
  setPhaseValues(0)
  surface.visible = s.surface !== undefined
  if (surface.visible) surface.material = MATERIALS[s.surface]
  ghost.visible = ghostEdges.visible = !!s.ghost
  scan.clear()
  refreshAll()
  setBuild(1)

  orbit.autoRotate = !!s.autoRotate
  if (s.focus) {
    const picked = pickFocusTet()
    focusTet = picked?.tet ?? -1
    refreshFocus()
    if (picked) {
      orbit.target.copy(picked.centroid)
      camera.position.copy(picked.centroid).addScaledVector(new THREE.Vector3(...s.camera).normalize(), modelScale * 0.21)
    }
  } else {
    focusTet = -1
    orbit.target.set(0, 0, 0)
    camera.position.set(...s.camera)
  }
  enteredAt = performance.now()
  renderCard()
  history.replaceState(null, '', `#${index + 1}`)
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------
STEPS.forEach((s, i) => {
  const b = document.createElement('button')
  b.textContent = String(i + 1)
  b.title = s.title
  b.onclick = () => enter(i)
  $('pills').append(b)
})

function renderCard() {
  const i = step.index
  $('num').textContent = `Step ${i + 1} of ${STEPS.length}`
  $('where').textContent = step.where
  $('title').innerHTML = `<span class="big">${i + 1}</span>${step.title}`
  $('body').innerHTML = step.body
  $('math-box').style.display = step.math ? '' : 'none'
  $('math').innerHTML = step.math ?? ''
  $('trick-box').style.display = step.trick ? '' : 'none'
  $('trick').innerHTML = step.trick ?? ''
  $('legend').innerHTML = step.legend ?? ''
  $('legend').style.display = step.legend ? '' : 'none'
  const showsField = step.scene.surface || step.scene.cap === 'field'
  $('colorbar-wrap').style.display = showsField ? '' : 'none'
  $('prev').disabled = i === 0
  $('next').disabled = i === STEPS.length - 1
  ;[...$('pills').children].forEach((b, k) => (b.className = k === i ? 'cur' : k < i ? 'done' : ''))
  $('card').scrollTop = 0
}

$('prev').onclick = () => enter(step.index - 1)
$('next').onclick = () => enter(step.index + 1)
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'PageDown') enter(step.index + 1)
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') enter(step.index - 1)
})

// ---------------------------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------------------------
const labelPool = []
function placeLabels(width, height) {
  while (labelPool.length < labels.length) {
    const div = document.createElement('div')
    $('labels').append(div)
    labelPool.push(div)
  }
  const v = new THREE.Vector3()
  labelPool.forEach((div, i) => {
    const label = labels[i]
    v.copy(label?.p ?? v).project(camera)
    if (!label || v.z > 1) return void (div.style.display = 'none')
    div.style.display = 'block'
    div.className = `lbl ${label.cls}`
    div.innerHTML = label.html
    div.style.left = `${((v.x + 1) / 2) * width}px`
    div.style.top = `${((1 - v.y) / 2) * height}px`
  })
}

function frame(now) {
  if (step.scene.anim) step.scene.anim((now - enteredAt) / 1000, ctx)
  if (dirty) {
    dirty = false
    writeGpu()
    refreshShapes()
    refreshArrows()
    refreshNodes()
    refreshCutTets()
    refreshOutline()
  }
  orbit.update()
  const width = view.clientWidth
  const height = view.clientHeight
  renderer.setSize(width, height, false)
  camera.aspect = width / Math.max(1, height)
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
  placeLabels(width, height)
  requestAnimationFrame(frame)
}

enter(Number(location.hash.slice(1)) - 1 || 0)
requestAnimationFrame(frame)
window.__steps = { enter, get step() { return step }, get cap() { return capParts } }
