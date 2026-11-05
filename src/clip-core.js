// A port of the application's clipping code to plain JavaScript, kept close to the source so the demo
// runs the same arithmetic the editor runs. Each block names the file it comes from, under
// components/simulation/editor/. Demo-only additions are marked "DEMO".
import * as THREE from 'three'

// ---------------------------------------------------------------------------------------------
// clipping/clipping-element.ts
// ---------------------------------------------------------------------------------------------
export const CLIP_VOLUME_MARGIN = 1e-4
export const DEFAULT_PLANE_HEIGHT = 1e-4
const DEFAULT_PLANE_NORMAL = new THREE.Vector3(0, 1, 0)
export const DEFAULT_PLANE_ROTATION = [0, Math.SQRT1_2, 0, Math.SQRT1_2]
const EQUALITY_EPSILON = 1e-6
/** The app holds 100 (MAX_CLIPPING_ELEMENTS); the demo keeps a smaller block. DEMO */
export const MAX_DEMO_VOLUMES = 16
export const MAX_DEMO_PLANES = 16

const vec = ([x, y, z]) => new THREE.Vector3(x, y, z)
const quat = ([x, y, z, w]) => new THREE.Quaternion(x, y, z, w)

export const isVolume = element => element.shape !== 'plane'

export function planeNormalOf(element, target = new THREE.Vector3()) {
  return target.copy(DEFAULT_PLANE_NORMAL).applyQuaternion(quat(element.rotation)).normalize()
}

/** A point p is removed when normal . p + constant < 0, as three.js clipping does. */
export function writeClippingPlane(element, target = new THREE.Plane()) {
  return target.setFromNormalAndCoplanarPoint(planeNormalOf(element), vec(element.center))
}

export function composeUnitShape(element, target = new THREE.Matrix4()) {
  return target.compose(vec(element.center), quat(element.rotation), vec(element.size).multiplyScalar(0.5))
}

/** Takes the scene to the unit cube [-1, 1]^3 or the unit ball of the volume. */
export function writeClippingVolumeMatrix(element, target = new THREE.Matrix4()) {
  return composeUnitShape(element, target).invert()
}

export function isInsideUnitShape(shape, local, margin = CLIP_VOLUME_MARGIN) {
  if (shape === 'box') return Math.max(Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)) < 1 + margin
  return local.length() < 1 + margin
}

const scratchMatrix = new THREE.Matrix4()
const scratchPoint = new THREE.Vector3()
const scratchPlane = new THREE.Plane()

export function clippingElementRemoves(element, point, margin = CLIP_VOLUME_MARGIN) {
  if (element.shape === 'plane') return writeClippingPlane(element, scratchPlane).distanceToPoint(point) < 0
  writeClippingVolumeMatrix(element, scratchMatrix)
  return isInsideUnitShape(element.shape, scratchPoint.copy(point).applyMatrix4(scratchMatrix), margin)
}

export function equivalentClippingVolumes(a, b) {
  const dot = Math.abs(a.rotation.reduce((sum, value, index) => sum + value * b.rotation[index], 0))
  return (
    isVolume(a) &&
    isVolume(b) &&
    a.shape === b.shape &&
    a.center.every((value, index) => Math.abs(value - b.center[index]) <= EQUALITY_EPSILON) &&
    a.size.every((value, index) => Math.abs(value - b.size[index]) <= EQUALITY_EPSILON) &&
    (a.shape === 'sphere' || Math.abs(dot - 1) <= EQUALITY_EPSILON)
  )
}

/**
 * The volume slot each element's cap reads as its group, -1 for planes. Equivalent volumes share the
 * first slot so their caps do not discard one another. `grouping: false` is DEMO: it shows the bug.
 */
export function clippingVolumeGroups(elements, grouping = true) {
  const groups = []
  const volumes = []
  for (const element of elements) {
    if (!isVolume(element)) {
      groups.push(-1)
      continue
    }
    const group = grouping ? volumes.findIndex(volume => equivalentClippingVolumes(volume, element)) : -1
    groups.push(group === -1 ? volumes.length : group)
    volumes.push(element)
  }
  return groups
}

/** The 6 face planes of a box, normals pointing out: a point outside the box has a positive distance. */
export function clippingBoxFacePlanes(element) {
  const rotation = quat(element.rotation)
  const center = vec(element.center)
  const planes = []
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [1, -1]) {
      const normal = new THREE.Vector3().setComponent(axis, sign).applyQuaternion(rotation)
      const half = element.size[axis] / 2
      planes.push(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center.clone().addScaledVector(normal, half)))
    }
  }
  return planes
}

export const BOX_FACE_NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z']

const UNIT_CUBE = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))
export function expandBoxByClippingElement(target, element) {
  if (!isVolume(element)) return target
  return target.union(UNIT_CUBE.clone().applyMatrix4(composeUnitShape(element, new THREE.Matrix4())))
}

// ---------------------------------------------------------------------------------------------
// clipping/clip-volume-material.ts: the uniform block and the shader patch
// ---------------------------------------------------------------------------------------------
export const CLIP_OWNER_ATTRIBUTE = 'dbClipOwner'
const SHAPE_CODES = { box: 1, sphere: 2 }

export function createClipVolumeUniforms() {
  return {
    dbClipVolumeCount: { value: 0 },
    dbClipVolumeMatrices: { value: Array.from({ length: MAX_DEMO_VOLUMES }, () => new THREE.Matrix4()) },
    dbClipVolumeShapes: { value: new Array(MAX_DEMO_VOLUMES).fill(0) },
    dbClipVolumeGroups: { value: new Array(MAX_DEMO_VOLUMES).fill(0) },
    // DEMO: switches that let the page break the rules on purpose, and the alternative Boolean modes.
    dbMargin: { value: CLIP_VOLUME_MARGIN },
    dbOwnerSkip: { value: 1 },
    dbMode: { value: 0 },
    dbPlaneCount: { value: 0 },
    dbPlanes: { value: Array.from({ length: MAX_DEMO_PLANES }, () => new THREE.Vector4()) },
  }
}

export function writeClipVolumes(uniforms, elements, { grouping = true } = {}) {
  let count = 0
  let planeCount = 0
  const groups = clippingVolumeGroups(elements, grouping)
  elements.forEach((element, index) => {
    if (element.shape === 'plane') {
      if (planeCount === MAX_DEMO_PLANES) return
      const plane = writeClippingPlane(element, scratchPlane)
      uniforms.dbPlanes.value[planeCount++].set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
      return
    }
    if (count === MAX_DEMO_VOLUMES) return
    writeClippingVolumeMatrix(element, uniforms.dbClipVolumeMatrices.value[count])
    uniforms.dbClipVolumeShapes.value[count] = SHAPE_CODES[element.shape]
    uniforms.dbClipVolumeGroups.value[count] = groups[index]
    count++
  })
  uniforms.dbClipVolumeCount.value = count
  uniforms.dbPlaneCount.value = planeCount
}

const vertexPars = isCap => `#include <clipping_planes_pars_vertex>
varying vec3 vDbClipVolumeWorld;${isCap ? `\nattribute float ${CLIP_OWNER_ATTRIBUTE};\nvarying float vDbClipOwner;` : ''}`

const vertexMain = isCap => `#include <clipping_planes_vertex>
vDbClipVolumeWorld = ( inverse( viewMatrix ) * vec4( mvPosition.xyz, 1.0 ) ).xyz;${
  isCap ? `\nvDbClipOwner = ${CLIP_OWNER_ATTRIBUTE};` : ''
}`

const fragmentPars = isCap => `#include <clipping_planes_pars_fragment>
varying vec3 vDbClipVolumeWorld;${isCap ? '\nvarying float vDbClipOwner;' : ''}
uniform int dbClipVolumeCount;
uniform mat4 dbClipVolumeMatrices[ ${MAX_DEMO_VOLUMES} ];
uniform int dbClipVolumeShapes[ ${MAX_DEMO_VOLUMES} ];
uniform int dbClipVolumeGroups[ ${MAX_DEMO_VOLUMES} ];
uniform float dbMargin;
uniform int dbOwnerSkip;
uniform int dbMode;
uniform int dbPlaneCount;
uniform vec4 dbPlanes[ ${MAX_DEMO_PLANES} ];
float dbExtent( int i ) {
	vec3 l = ( dbClipVolumeMatrices[ i ] * vec4( vDbClipVolumeWorld, 1.0 ) ).xyz;
	return dbClipVolumeShapes[ i ] == 1 ? max( max( abs( l.x ), abs( l.y ) ), abs( l.z ) ) : length( l );
}`

// Mode 0 is the application's loop, unchanged apart from the demo switches. Modes 1 and 2 are the
// demo's alternative Boolean rules: planes then come through dbPlanes instead of three.js.
const fragmentMain = isCap => `#include <clipping_planes_fragment>
if ( dbMode == 0 ) {
	for ( int dbClipVolume = 0; dbClipVolume < ${MAX_DEMO_VOLUMES}; dbClipVolume ++ ) {
		if ( dbClipVolume >= dbClipVolumeCount ) break;${
      isCap
        ? `
		if ( dbOwnerSkip == 1 && abs( float( dbClipVolumeGroups[ dbClipVolume ] ) - vDbClipOwner ) < 0.5 ) continue;`
        : ''
    }
		if ( dbExtent( dbClipVolume ) < 1.0 + dbMargin ) discard;
	}
} else {
	int dbTotal = 0;
	int dbInside = 0;${
    isCap
      ? ''
      : `
	for ( int p = 0; p < ${MAX_DEMO_PLANES}; p ++ ) {
		if ( p >= dbPlaneCount ) break;
		dbTotal ++;
		if ( dot( dbPlanes[ p ].xyz, vDbClipVolumeWorld ) + dbPlanes[ p ].w < 0.0 ) dbInside ++;
	}`
  }
	for ( int v = 0; v < ${MAX_DEMO_VOLUMES}; v ++ ) {
		if ( v >= dbClipVolumeCount ) break;${
      isCap ? `\n\t\tif ( dbOwnerSkip == 1 && abs( float( dbClipVolumeGroups[ v ] ) - vDbClipOwner ) < 0.5 ) continue;` : ''
    }
		dbTotal ++;
		if ( dbExtent( v ) < 1.0 + dbMargin ) dbInside ++;
	}
	bool dbRemoved = dbMode == 1
		? ${isCap ? 'dbInside < dbTotal' : '( dbTotal > 0 && dbInside == dbTotal )'}
		: ${isCap ? 'dbInside > 0' : 'dbInside == 0'};
	if ( dbRemoved ) discard;
}`

/** Adds the volume test after three's clipping chunks, as `patchClipVolumes` does. */
export function patchClipVolumes(material, uniforms, isCap = false) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <clipping_planes_pars_vertex>', vertexPars(isCap))
      .replace('#include <clipping_planes_vertex>', vertexMain(isCap))
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', fragmentPars(isCap))
      .replace('#include <clipping_planes_fragment>', fragmentMain(isCap))
  }
  material.customProgramCacheKey = () => `clip-volumes${isCap ? '-cap' : ''}`
  material.userData.clipVolumes = uniforms
  material.userData.isCap = isCap
  return material
}

export const SHADER_SOURCE = { fragmentMain: fragmentMain(false), fragmentMainCap: fragmentMain(true), vertexMain: vertexMain(true) }

// ---------------------------------------------------------------------------------------------
// clipping/clipping-cap.ts: the recipe
// ---------------------------------------------------------------------------------------------
const planeLike = ({ normal, constant }) => ({ normal: { x: normal.x, y: normal.y, z: normal.z }, constant })
const negated = p => ({ normal: { x: -p.normal.x, y: -p.normal.y, z: -p.normal.z }, constant: -p.constant })

/**
 * `mode` 'union' is the app. 'intersection' (DEMO) keeps a section where the other planes remove,
 * so it clips by the negated planes. 'inverted' (DEMO) keeps the same set as 'union'.
 */
export function clippingCapRecipe(elements, { mode = 'union', grouping = true, names = {} } = {}) {
  const planeElements = elements.filter(element => element.shape === 'plane')
  const planes = planeElements.map(element => planeLike(writeClippingPlane(element, new THREE.Plane())))
  const planesExcept = owner =>
    planes.filter((_, index) => planeElements[index] !== owner).map(p => (mode === 'intersection' ? negated(p) : p))

  const recipe = { sections: [], spheres: [], volumes: [] }
  const groups = clippingVolumeGroups(elements, grouping)
  let volumeIndex = 0
  elements.forEach((element, elementIndex) => {
    const others = planesExcept(element)
    const name = names[element.id] ?? element.id
    if (element.shape === 'plane') {
      recipe.sections.push({ plane: planes[planeElements.indexOf(element)], keep: others, label: name, elementId: element.id })
      return
    }
    const owner = volumeIndex++
    recipe.volumes.push({
      shape: element.shape,
      inverse: [...writeClippingVolumeMatrix(element, new THREE.Matrix4()).elements],
      group: groups[elementIndex],
      elementId: element.id,
    })
    if (groups[elementIndex] !== owner) return
    if (element.shape === 'box') {
      const faces = clippingBoxFacePlanes(element)
      faces.forEach((face, index) => {
        const inside = faces.filter((_, other) => other !== index).map(other => planeLike(other.clone().negate()))
        recipe.sections.push({
          plane: planeLike(face),
          keep: [...inside, ...others],
          owner,
          label: `${name} face ${BOX_FACE_NAMES[index]}`,
          elementId: element.id,
        })
      })
      return
    }
    const [x, y, z] = element.center
    recipe.spheres.push({ center: { x, y, z }, radius: element.size[0] / 2, keep: others, owner, label: name, elementId: element.id })
  })
  return recipe
}

// ---------------------------------------------------------------------------------------------
// utils/tetrahedron.ts: flat sections in tetrahedra
// ---------------------------------------------------------------------------------------------
export const NO_CAP_OWNER = -1
export const SECTION_EPS = 1e-6
const EPS = SECTION_EPS
export const EDGE_A = [0, 0, 0, 1, 1, 2]
export const EDGE_B = [1, 2, 3, 2, 3, 3]
const MAX_POLYGON_VERTICES = 16

export const makePolygon = (capacity = MAX_POLYGON_VERTICES) => ({
  count: 0,
  xyz: new Float64Array(capacity * 3),
  weights: new Float64Array(capacity * 4),
})

class Growable {
  constructor(make) {
    this.make = make
    this.data = make(1024)
    this.length = 0
  }
  reserve(extra) {
    if (this.length + extra <= this.data.length) return
    const grown = this.make(Math.max(this.data.length * 2, this.length + extra))
    grown.set(this.data.subarray(0, this.length))
    this.data = grown
  }
  push(value) {
    this.reserve(1)
    this.data[this.length++] = value
  }
  view() {
    return this.data.slice(0, this.length)
  }
}

export function makeCapOutput() {
  return {
    positions: new Growable(size => new Float32Array(size)),
    indices: new Growable(size => new Uint32Array(size)),
    faceTets: new Growable(size => new Uint32Array(size)),
    vertexTets: new Growable(size => new Uint32Array(size)),
    weights: new Growable(size => new Float32Array(size)),
    owners: new Growable(size => new Float32Array(size)),
    faceSections: new Growable(size => new Int32Array(size)), // DEMO: which recipe part made each face
    owner: NO_CAP_OWNER,
    section: -1,
  }
}

export function viewCapOutput(output) {
  return {
    positions: output.positions.view(),
    indices: output.indices.view(),
    capFaceTetrahedronIndices: output.faceTets.view(),
    vertexTets: output.vertexTets.view(),
    weights: output.weights.view(),
    vertexOwners: output.owners.view(),
    faceSections: output.faceSections.view(),
  }
}

export function emitVertex(output, x, y, z, tet, weights, weightOffset = 0) {
  const index = output.positions.length / 3
  output.positions.push(x)
  output.positions.push(y)
  output.positions.push(z)
  output.vertexTets.push(tet)
  for (let c = 0; c < 4; c++) output.weights.push(weights[weightOffset + c])
  output.owners.push(output.owner)
  return index
}

export function emitFace(output, a, b, c, tet) {
  output.indices.push(a)
  output.indices.push(b)
  output.indices.push(c)
  output.faceTets.push(tet)
  output.faceSections.push(output.section)
}

/** Fan from the first vertex, wound backwards: the cap faces the removed side. */
export function emitFan(output, shape, tet) {
  const first = output.positions.length / 3
  for (let v = 0; v < shape.count; v++) {
    emitVertex(output, shape.xyz[v * 3], shape.xyz[v * 3 + 1], shape.xyz[v * 3 + 2], tet, shape.weights, v * 4)
  }
  for (let v = 1; v < shape.count - 1; v++) emitFace(output, first, first + v + 1, first + v, tet)
}

export function mergeCapParts(parts) {
  const filled = parts.filter(part => part.indices.length > 0)
  if (filled.length <= 1) return filled[0] ?? parts[0] ?? viewCapOutput(makeCapOutput())
  const output = makeCapOutput()
  for (const part of filled) {
    const offset = output.positions.length / 3
    for (let v = 0; v < part.positions.length / 3; v++) {
      output.owner = part.vertexOwners[v]
      emitVertex(output, part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2], part.vertexTets[v], part.weights, v * 4)
    }
    for (let f = 0; f < part.indices.length / 3; f++) {
      output.section = part.faceSections[f]
      emitFace(output, part.indices[f * 3] + offset, part.indices[f * 3 + 1] + offset, part.indices[f * 3 + 2] + offset, part.capFaceTetrahedronIndices[f])
    }
  }
  return viewCapOutput(output)
}

export function addVertex(polygon, x, y, z, a, b, t) {
  for (let v = 0; v < polygon.count; v++) {
    const dx = polygon.xyz[v * 3] - x
    const dy = polygon.xyz[v * 3 + 1] - y
    const dz = polygon.xyz[v * 3 + 2] - z
    if (dx * dx + dy * dy + dz * dz <= EPS * EPS) return false
  }
  const v = polygon.count++
  polygon.xyz[v * 3] = x
  polygon.xyz[v * 3 + 1] = y
  polygon.xyz[v * 3 + 2] = z
  for (let k = 0; k < 4; k++) polygon.weights[v * 4 + k] = 0
  if (b < 0) polygon.weights[v * 4 + a] = 1
  else {
    polygon.weights[v * 4 + a] = 1 - t
    polygon.weights[v * 4 + b] = t
  }
  return true
}

/** A basis (t, b) of the plane: "up" is Y when the normal is near X, X otherwise. */
export function planeBasis(nx, ny, nz) {
  const useYUp = Math.abs(nx) > 0.9
  const upX = useYUp ? 0 : 1
  const upY = useYUp ? 1 : 0
  let tx = upY * nz
  let ty = -upX * nz
  let tz = upX * ny - upY * nx
  const tLen = Math.hypot(tx, ty, tz) || 1
  tx /= tLen
  ty /= tLen
  tz /= tLen
  return { t: [tx, ty, tz], b: [ny * tz - nz * ty, nz * tx - nx * tz, nx * ty - ny * tx] }
}

export function sortByAngle(polygon, basis, angles = new Float64Array(MAX_POLYGON_VERTICES), order = new Uint8Array(MAX_POLYGON_VERTICES), scratch = makePolygon()) {
  const [tx, ty, tz] = basis.t
  const [bx, by, bz] = basis.b
  const count = polygon.count
  let cx = 0
  let cy = 0
  let cz = 0
  for (let v = 0; v < count; v++) {
    cx += polygon.xyz[v * 3]
    cy += polygon.xyz[v * 3 + 1]
    cz += polygon.xyz[v * 3 + 2]
  }
  cx /= count
  cy /= count
  cz /= count
  for (let v = 0; v < count; v++) {
    const dx = polygon.xyz[v * 3] - cx
    const dy = polygon.xyz[v * 3 + 1] - cy
    const dz = polygon.xyz[v * 3 + 2] - cz
    angles[v] = Math.atan2(dx * bx + dy * by + dz * bz, dx * tx + dy * ty + dz * tz)
    order[v] = v
  }
  for (let i = 1; i < count; i++) {
    const current = order[i]
    let j = i - 1
    while (j >= 0 && angles[order[j]] > angles[current]) {
      order[j + 1] = order[j]
      j--
    }
    order[j + 1] = current
  }
  for (let k = 0; k < count * 3; k++) scratch.xyz[k] = polygon.xyz[k]
  for (let k = 0; k < count * 4; k++) scratch.weights[k] = polygon.weights[k]
  for (let v = 0; v < count; v++) {
    const from = order[v]
    for (let k = 0; k < 3; k++) polygon.xyz[v * 3 + k] = scratch.xyz[from * 3 + k]
    for (let k = 0; k < 4; k++) polygon.weights[v * 4 + k] = scratch.weights[from * 4 + k]
  }
  return { centroid: [cx, cy, cz], angles: Array.from(angles.subarray(0, count)), order: Array.from(order.subarray(0, count)) }
}

/** Sutherland-Hodgman: keep the part of `source` with distance >= -tolerance into `target`. */
export function clipByPlane(source, plane, target, tolerance = EPS) {
  const { x: nx, y: ny, z: nz } = plane.normal
  const maxVertices = target.xyz.length / 3
  const distance = v => nx * source.xyz[v * 3] + ny * source.xyz[v * 3 + 1] + nz * source.xyz[v * 3 + 2] + plane.constant
  target.count = 0
  const push = (from, to, t) => {
    if (target.count >= maxVertices) return
    const v = target.count++
    for (let k = 0; k < 3; k++) {
      const a = source.xyz[from * 3 + k]
      target.xyz[v * 3 + k] = a + (source.xyz[to * 3 + k] - a) * t
    }
    for (let k = 0; k < 4; k++) {
      const a = source.weights[from * 4 + k]
      target.weights[v * 4 + k] = a + (source.weights[to * 4 + k] - a) * t
    }
  }
  for (let v = 0; v < source.count; v++) {
    const next = (v + 1) % source.count
    const dCurrent = distance(v)
    const dNext = distance(next)
    const currentInside = dCurrent >= -tolerance
    if (currentInside) push(v, v, 0)
    if (currentInside !== dNext >= -tolerance) {
      const denom = dCurrent - dNext
      const t = Math.abs(denom) < tolerance ? 0 : dCurrent / denom
      push(v, next, Math.min(Math.max(t, 0), 1))
    }
  }
}

// The slab index (tetrahedron.ts) and its cache policy (slab-index-cache.ts).
const NO_TETS = new Uint32Array(0)
const MAX_BUCKETS = 4096

export function buildTetSlabIndex(positions, indices, normal) {
  const numTetrahedra = indices.length / 4
  const { x: nx, y: ny, z: nz } = normal
  const lows = new Float64Array(numTetrahedra)
  const highs = new Float64Array(numTetrahedra)
  let min = Infinity
  let max = -Infinity
  let extentSum = 0
  for (let tet = 0; tet < numTetrahedra; tet++) {
    let low = Infinity
    let high = -Infinity
    for (let c = 0; c < 4; c++) {
      const node = indices[tet * 4 + c] * 3
      const p = nx * positions[node] + ny * positions[node + 1] + nz * positions[node + 2]
      if (p < low) low = p
      if (p > high) high = p
    }
    lows[tet] = low
    highs[tet] = high
    if (low < min) min = low
    if (high > max) max = high
    extentSum += high - low
  }
  const span = max - min
  const meanExtent = numTetrahedra > 0 ? extentSum / numTetrahedra : 0
  const step = Math.max(meanExtent * 2, span / MAX_BUCKETS) || 1
  const bucketCount = span > 0 ? Math.ceil(span / step) + 1 : 1
  const bucketOf = p => Math.min(bucketCount - 1, Math.max(0, Math.floor((p - min) / step)))
  const offsets = new Uint32Array(bucketCount + 1)
  for (let tet = 0; tet < numTetrahedra; tet++)
    for (let b = bucketOf(lows[tet] - EPS), last = bucketOf(highs[tet] + EPS); b <= last; b++) offsets[b + 1]++
  for (let b = 0; b < bucketCount; b++) offsets[b + 1] += offsets[b]
  const tets = new Uint32Array(offsets[bucketCount])
  const cursor = offsets.slice(0, bucketCount)
  for (let tet = 0; tet < numTetrahedra; tet++)
    for (let b = bucketOf(lows[tet] - EPS), last = bucketOf(highs[tet] + EPS); b <= last; b++) tets[cursor[b]++] = tet
  return { normal: { x: nx, y: ny, z: nz }, start: min, step, offsets, tets }
}

export function tetsCutBy(index, plane) {
  const { x, y, z } = plane.normal
  const sameWay = x * index.normal.x + y * index.normal.y + z * index.normal.z >= 0
  const offset = sameWay ? -plane.constant : plane.constant
  return tetsOverlapping(index, offset, offset)
}

export function tetsOverlapping(index, low, high) {
  const { offsets, tets } = index
  const bucketCount = offsets.length - 1
  const first = Math.max(0, Math.floor((low - index.start) / index.step))
  const last = Math.min(bucketCount - 1, Math.floor((high - index.start) / index.step))
  if (first > last) return NO_TETS
  if (first === last) return tets.subarray(offsets[first], offsets[first + 1])
  const unique = new Uint32Array(offsets[last + 1] - offsets[first])
  let count = 0
  for (let k = offsets[first]; k < offsets[first + 1]; k++) unique[count++] = tets[k]
  for (let bucket = first + 1; bucket <= last; bucket++) {
    let previous = offsets[bucket - 1]
    const previousEnd = offsets[bucket]
    for (let k = offsets[bucket]; k < offsets[bucket + 1]; k++) {
      const tet = tets[k]
      while (previous < previousEnd && tets[previous] < tet) previous++
      if (previous < previousEnd && tets[previous] === tet) continue
      unique[count++] = tet
    }
  }
  return unique.subarray(0, count)
}

export function canonicalNormal({ x, y, z }) {
  const flip = x < 0 || (x === 0 && (y < 0 || (y === 0 && z < 0)))
  return flip ? { x: -x, y: -y, z: -z } : { x, y, z }
}

class LRU {
  constructor(max) {
    this.max = max
    this.map = new Map()
  }
  get(key) {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key)
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }
  peek(key) {
    return this.map.get(key)
  }
  set(key, value) {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value)
  }
  delete(key) {
    this.map.delete(key)
  }
}

/** A normal earns an index once a later build sees it again; 6 indices kept, least recent dropped. */
export function makeSlabIndexCache(positions, indices) {
  const slabIndices = new LRU(6)
  const seenIn = new LRU(12)
  let build = 0
  const cache = planes => {
    build++
    cache.lastBuilt = 0
    return planes.map(plane => {
      const normal = canonicalNormal(plane.normal)
      const key = `${normal.x.toFixed(6)},${normal.y.toFixed(6)},${normal.z.toFixed(6)}`
      const known = slabIndices.get(key)
      if (known) return known
      const lastSeen = seenIn.peek(key)
      if (lastSeen === undefined || lastSeen === build) {
        seenIn.set(key, build)
        return null
      }
      seenIn.delete(key)
      const built = buildTetSlabIndex(positions, indices, normal)
      slabIndices.set(key, built)
      cache.lastBuilt++
      return built
    })
  }
  cache.size = () => slabIndices.map.size
  return cache
}

/** The flat sections of a recipe, one polygon per cut tetrahedron. `stats` is DEMO bookkeeping. */
export function buildSectionCapParts(positions, indices, sections, stats = {}, sectionOffset = 0) {
  const numPoints = positions.length / 3
  const numTetrahedra = indices.length / 4
  const output = makeCapOutput()
  const signedDistances = new Float32Array(numPoints)
  const polygon = makePolygon()
  const clipped = makePolygon()
  const angles = new Float64Array(MAX_POLYGON_VERTICES)
  const order = new Uint8Array(MAX_POLYGON_VERTICES)
  const tetDistances = new Float64Array(4)
  stats.visited = stats.visited ?? 0
  stats.cut = stats.cut ?? 0
  stats.skippedByKeep = stats.skippedByKeep ?? 0
  stats.emptyAfterClip = stats.emptyAfterClip ?? 0

  sections.forEach(({ plane, keep, slabIndex, owner = NO_CAP_OWNER }, sectionIndex) => {
    output.owner = owner
    output.section = sectionOffset + sectionIndex
    const { x: nx, y: ny, z: nz } = plane.normal
    const constant = plane.constant
    const candidates = slabIndex ? tetsCutBy(slabIndex, plane) : null
    if (!candidates) {
      for (let i = 0; i < numPoints; i++) {
        signedDistances[i] = nx * positions[i * 3] + ny * positions[i * 3 + 1] + nz * positions[i * 3 + 2] + constant
      }
    }
    const basis = planeBasis(nx, ny, nz)
    const visitCount = candidates ? candidates.length : numTetrahedra
    stats.visited += visitCount
    for (let visit = 0; visit < visitCount; visit++) {
      const tet = candidates ? candidates[visit] : visit
      const offset = tet * 4
      let kept = 0
      for (let c = 0; c < 4; c++) {
        const node = indices[offset + c]
        const d = candidates
          ? nx * positions[node * 3] + ny * positions[node * 3 + 1] + nz * positions[node * 3 + 2] + constant
          : signedDistances[node]
        tetDistances[c] = d
        if (d > EPS) kept++
      }
      if (kept === 0 || kept === 4) continue
      let removed = false
      for (let other = 0; other < keep.length && !removed; other++) {
        const { normal, constant: keepConstant } = keep[other]
        removed = true
        for (let c = 0; c < 4 && removed; c++) {
          const node = indices[offset + c] * 3
          const d = normal.x * positions[node] + normal.y * positions[node + 1] + normal.z * positions[node + 2]
          removed = d + keepConstant < -EPS
        }
      }
      if (removed) {
        stats.skippedByKeep++
        continue
      }
      stats.cut++
      polygon.count = 0
      for (let c = 0; c < 4; c++) {
        if (Math.abs(tetDistances[c]) > EPS) continue
        const node = indices[offset + c] * 3
        addVertex(polygon, positions[node], positions[node + 1], positions[node + 2], c, -1, 0)
      }
      for (let edge = 0; edge < 6; edge++) {
        const a = EDGE_A[edge]
        const b = EDGE_B[edge]
        const dA = tetDistances[a]
        const dB = tetDistances[b]
        if (Math.abs(dA) <= EPS || Math.abs(dB) <= EPS || dA > 0 === dB > 0) continue
        const t = dA / (dA - dB)
        const nodeA = indices[offset + a] * 3
        const nodeB = indices[offset + b] * 3
        addVertex(
          polygon,
          positions[nodeA] + t * (positions[nodeB] - positions[nodeA]),
          positions[nodeA + 1] + t * (positions[nodeB + 1] - positions[nodeA + 1]),
          positions[nodeA + 2] + t * (positions[nodeB + 2] - positions[nodeA + 2]),
          a,
          b,
          t
        )
      }
      if (polygon.count < 3) continue
      sortByAngle(polygon, basis, angles, order, clipped)
      let shape = polygon
      for (let other = 0; other < keep.length && shape.count >= 3; other++) {
        const target = shape === polygon ? clipped : polygon
        clipByPlane(shape, keep[other], target)
        shape = target
      }
      if (shape.count < 3) {
        stats.emptyAfterClip++
        continue
      }
      emitFan(output, shape, tet)
    }
  })
  return viewCapOutput(output)
}

/** DEMO: replays the section of one tetrahedron and keeps every intermediate value. */
export function traceSectionTet(positions, indices, section, tet) {
  const { plane, keep } = section
  const { x: nx, y: ny, z: nz } = plane.normal
  const corners = []
  const d = []
  for (let c = 0; c < 4; c++) {
    const node = indices[tet * 4 + c]
    const p = [positions[node * 3], positions[node * 3 + 1], positions[node * 3 + 2]]
    corners.push(p)
    d.push(nx * p[0] + ny * p[1] + nz * p[2] + plane.constant)
  }
  const kept = d.filter(value => value > EPS).length
  const trace = { tet, nodes: Array.from(indices.subarray(tet * 4, tet * 4 + 4)), corners, d, kept, crossings: [], onPlane: [] }
  if (kept === 0 || kept === 4) {
    trace.status = kept === 4 ? 'kept whole' : 'removed whole'
    return trace
  }
  trace.keepTests = keep.map(k => {
    const ds = corners.map(p => k.normal.x * p[0] + k.normal.y * p[1] + k.normal.z * p[2] + k.constant)
    return { ds, removesAll: ds.every(value => value < -EPS) }
  })
  if (trace.keepTests.some(test => test.removesAll)) {
    trace.status = 'skipped: wholly outside another kept half-space'
    return trace
  }
  const polygon = makePolygon()
  for (let c = 0; c < 4; c++) {
    if (Math.abs(d[c]) > EPS) continue
    if (addVertex(polygon, ...corners[c], c, -1, 0)) trace.onPlane.push(c)
  }
  for (let edge = 0; edge < 6; edge++) {
    const a = EDGE_A[edge]
    const b = EDGE_B[edge]
    const dA = d[a]
    const dB = d[b]
    const crosses = !(Math.abs(dA) <= EPS || Math.abs(dB) <= EPS || dA > 0 === dB > 0)
    if (!crosses) continue
    const t = dA / (dA - dB)
    const point = corners[a].map((value, k) => value + t * (corners[b][k] - value))
    const added = addVertex(polygon, ...point, a, b, t)
    trace.crossings.push({ edge, a, b, dA, dB, t, point, added })
  }
  trace.raw = polygonPoints(polygon)
  if (polygon.count < 3) {
    trace.status = 'degenerate: fewer than 3 points'
    return trace
  }
  const sorted = sortByAngle(polygon, planeBasis(nx, ny, nz))
  trace.basis = planeBasis(nx, ny, nz)
  trace.centroid = sorted.centroid
  trace.angles = sorted.angles
  trace.order = sorted.order
  trace.sorted = polygonPoints(polygon)
  trace.clipSteps = []
  let shape = polygon
  const scratch = makePolygon()
  for (let other = 0; other < keep.length && shape.count >= 3; other++) {
    const target = shape === polygon ? scratch : polygon
    const before = shape.count
    clipByPlane(shape, keep[other], target)
    trace.clipSteps.push({ plane: other, before, after: target.count, points: polygonPoints(target) })
    shape = target
  }
  trace.final = polygonPoints(shape)
  trace.fan = []
  for (let v = 1; v < shape.count - 1; v++) trace.fan.push([0, v + 1, v])
  trace.status = shape.count >= 3 ? `cap polygon of ${shape.count} vertices, ${shape.count - 2} triangle${shape.count - 2 === 1 ? '' : 's'}` : 'clipped away by another plane'
  return trace
}

function polygonPoints(polygon) {
  const out = []
  for (let v = 0; v < polygon.count; v++) {
    out.push({
      p: [polygon.xyz[v * 3], polygon.xyz[v * 3 + 1], polygon.xyz[v * 3 + 2]],
      w: Array.from(polygon.weights.subarray(v * 4, v * 4 + 4)),
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// utils/sphere-cap.ts: a sphere cap from an icosphere clipped by each tetrahedron
// ---------------------------------------------------------------------------------------------
const SPHERE_EPS = 1e-9
const GRID_SIZE = 24
const MAX_PIECE_VERTICES = 32
const icospheres = new Map()

export function getUnitIcosphere(level = 5) {
  if (icospheres.has(level)) return icospheres.get(level)
  const t = (1 + Math.sqrt(5)) / 2
  const vertices = []
  const add = (x, y, z) => {
    const length = Math.hypot(x, y, z)
    vertices.push(x / length, y / length, z / length)
    return vertices.length / 3 - 1
  }
  for (const [x, y, z] of [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ])
    add(x, y, z)
  let triangles = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2,
    3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ]
  for (let l = 0; l < level; l++) {
    const midpoints = new Map()
    const midpoint = (a, b) => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a
      const known = midpoints.get(key)
      if (known !== undefined) return known
      const index = add(vertices[a * 3] + vertices[b * 3], vertices[a * 3 + 1] + vertices[b * 3 + 1], vertices[a * 3 + 2] + vertices[b * 3 + 2])
      midpoints.set(key, index)
      return index
    }
    const next = []
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]]
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca)
    }
    triangles = next
  }
  const sphere = { vertices: Float64Array.from(vertices), triangles: Uint32Array.from(triangles) }
  icospheres.set(level, sphere)
  return sphere
}

const makePlane = () => ({ normal: { x: 0, y: 0, z: 0 }, constant: 0 })
const TET_FACES = [
  [1, 2, 3, 0],
  [0, 2, 3, 1],
  [0, 1, 3, 2],
  [0, 1, 2, 3],
]

export function prepareTetrahedron(corners, inverse, planes) {
  const x0 = corners[0]
  const y0 = corners[1]
  const z0 = corners[2]
  const ax = corners[3] - x0
  const ay = corners[4] - y0
  const az = corners[5] - z0
  const bx = corners[6] - x0
  const by = corners[7] - y0
  const bz = corners[8] - z0
  const cx = corners[9] - x0
  const cy = corners[10] - y0
  const cz = corners[11] - z0
  const det = ax * (by * cz - bz * cy) - bx * (ay * cz - az * cy) + cx * (ay * bz - az * by)
  if (Math.abs(det) < SPHERE_EPS * SPHERE_EPS) return false
  inverse[0] = (by * cz - bz * cy) / det
  inverse[1] = (bz * cx - bx * cz) / det
  inverse[2] = (bx * cy - by * cx) / det
  inverse[3] = (az * cy - ay * cz) / det
  inverse[4] = (ax * cz - az * cx) / det
  inverse[5] = (ay * cx - ax * cy) / det
  inverse[6] = (ay * bz - az * by) / det
  inverse[7] = (az * bx - ax * bz) / det
  inverse[8] = (ax * by - ay * bx) / det
  for (let face = 0; face < 4; face++) {
    const [i, j, k, opposite] = TET_FACES[face]
    const ux = corners[j * 3] - corners[i * 3]
    const uy = corners[j * 3 + 1] - corners[i * 3 + 1]
    const uz = corners[j * 3 + 2] - corners[i * 3 + 2]
    const vx = corners[k * 3] - corners[i * 3]
    const vy = corners[k * 3 + 1] - corners[i * 3 + 1]
    const vz = corners[k * 3 + 2] - corners[i * 3 + 2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length
    let constant = -(nx * corners[i * 3] + ny * corners[i * 3 + 1] + nz * corners[i * 3 + 2])
    const side = nx * corners[opposite * 3] + ny * corners[opposite * 3 + 1] + nz * corners[opposite * 3 + 2] + constant
    if (side < 0) {
      nx = -nx
      ny = -ny
      nz = -nz
      constant = -constant
    }
    planes[face].normal.x = nx
    planes[face].normal.y = ny
    planes[face].normal.z = nz
    planes[face].constant = constant
  }
  return true
}

function loadCorner(piece, v, vertices, corners, inverse, vertex) {
  const x = vertices[vertex * 3]
  const y = vertices[vertex * 3 + 1]
  const z = vertices[vertex * 3 + 2]
  piece.xyz[v * 3] = x
  piece.xyz[v * 3 + 1] = y
  piece.xyz[v * 3 + 2] = z
  const px = x - corners[0]
  const py = y - corners[1]
  const pz = z - corners[2]
  const w1 = inverse[0] * px + inverse[1] * py + inverse[2] * pz
  const w2 = inverse[3] * px + inverse[4] * py + inverse[5] * pz
  const w3 = inverse[6] * px + inverse[7] * py + inverse[8] * pz
  piece.weights[v * 4] = 1 - w1 - w2 - w3
  piece.weights[v * 4 + 1] = w1
  piece.weights[v * 4 + 2] = w2
  piece.weights[v * 4 + 3] = w3
}

function facesSides(piece, planes) {
  let inside = true
  for (let face = 0; face < 4; face++) {
    const { normal, constant } = planes[face]
    let outside = 0
    for (let v = 0; v < 3; v++) {
      const d = normal.x * piece.xyz[v * 3] + normal.y * piece.xyz[v * 3 + 1] + normal.z * piece.xyz[v * 3 + 2] + constant
      if (d < -SPHERE_EPS) outside++
    }
    if (outside === 3) return 0
    if (outside > 0) inside = false
  }
  return inside ? 1 : 2
}

export function buildSphereCapParts(positions, indices, sphere, slabIndex = null, stats = {}, section = -1, level = 5) {
  const output = makeCapOutput()
  output.owner = sphere.owner ?? NO_CAP_OWNER
  output.section = section
  const { x: cx, y: cy, z: cz } = sphere.center
  const radius = sphere.radius
  if (!(radius > 0)) return viewCapOutput(output)
  const radius2 = radius * radius
  const unit = getUnitIcosphere(level)
  const vertexCount = unit.vertices.length / 3
  const sphereVertices = new Float64Array(unit.vertices.length)
  for (let v = 0; v < vertexCount; v++) {
    sphereVertices[v * 3] = cx + unit.vertices[v * 3] * radius
    sphereVertices[v * 3 + 1] = cy + unit.vertices[v * 3 + 1] * radius
    sphereVertices[v * 3 + 2] = cz + unit.vertices[v * 3 + 2] * radius
  }
  const triangleCount = unit.triangles.length / 3
  const cellSize = (2 * radius) / GRID_SIZE
  const cellOf = (value, origin) => Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((value - (origin - radius)) / cellSize)))
  const cellCounts = new Uint32Array(GRID_SIZE ** 3 + 1)
  const triangleBoxes = new Float64Array(triangleCount * 6)
  const triangleCells = new Int32Array(triangleCount * 6)
  for (let tri = 0; tri < triangleCount; tri++) {
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (let corner = 0; corner < 3; corner++) {
      const v = unit.triangles[tri * 3 + corner] * 3
      minX = Math.min(minX, sphereVertices[v])
      maxX = Math.max(maxX, sphereVertices[v])
      minY = Math.min(minY, sphereVertices[v + 1])
      maxY = Math.max(maxY, sphereVertices[v + 1])
      minZ = Math.min(minZ, sphereVertices[v + 2])
      maxZ = Math.max(maxZ, sphereVertices[v + 2])
    }
    const box = tri * 6
    triangleBoxes.set([minX, maxX, minY, maxY, minZ, maxZ], box)
    triangleCells.set([cellOf(minX, cx), cellOf(maxX, cx), cellOf(minY, cy), cellOf(maxY, cy), cellOf(minZ, cz), cellOf(maxZ, cz)], box)
    for (let x = triangleCells[box]; x <= triangleCells[box + 1]; x++)
      for (let y = triangleCells[box + 2]; y <= triangleCells[box + 3]; y++)
        for (let z = triangleCells[box + 4]; z <= triangleCells[box + 5]; z++) cellCounts[(x * GRID_SIZE + y) * GRID_SIZE + z + 1]++
  }
  for (let cell = 0; cell < GRID_SIZE ** 3; cell++) cellCounts[cell + 1] += cellCounts[cell]
  const cellTriangles = new Uint32Array(cellCounts[GRID_SIZE ** 3])
  const cursor = cellCounts.slice(0, GRID_SIZE ** 3)
  for (let tri = 0; tri < triangleCount; tri++) {
    const box = tri * 6
    for (let x = triangleCells[box]; x <= triangleCells[box + 1]; x++)
      for (let y = triangleCells[box + 2]; y <= triangleCells[box + 3]; y++)
        for (let z = triangleCells[box + 4]; z <= triangleCells[box + 5]; z++) cellTriangles[cursor[(x * GRID_SIZE + y) * GRID_SIZE + z]++] = tri
  }

  const seen = new Uint32Array(triangleCount)
  let stamp = 0
  const piece = makePolygon(MAX_PIECE_VERTICES)
  const scratch = makePolygon(MAX_PIECE_VERTICES)
  const corners = new Float64Array(12)
  const inverse = new Float64Array(9)
  const tetPlanes = [makePlane(), makePlane(), makePlane(), makePlane()]
  let candidates = null
  if (slabIndex) {
    const { x: nx, y: ny, z: nz } = slabIndex.normal
    const along = nx * cx + ny * cy + nz * cz
    candidates = tetsOverlapping(slabIndex, along - radius, along + radius)
  }
  const visitCount = candidates ? candidates.length : indices.length / 4
  stats.visited = (stats.visited ?? 0) + visitCount
  stats.sphereTriangles = triangleCount
  stats.sphereTets = stats.sphereTets ?? 0
  for (let visit = 0; visit < visitCount; visit++) {
    const tet = candidates ? candidates[visit] : visit
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    let inside = 0
    let farthest = 0
    for (let corner = 0; corner < 4; corner++) {
      const node = indices[tet * 4 + corner] * 3
      const x = positions[node]
      const y = positions[node + 1]
      const z = positions[node + 2]
      corners[corner * 3] = x
      corners[corner * 3 + 1] = y
      corners[corner * 3 + 2] = z
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
      const distance2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2
      if (distance2 < radius2) inside++
      farthest = Math.max(farthest, distance2)
    }
    if (inside === 4 || farthest < radius2) continue
    const nearX = Math.max(minX, Math.min(cx, maxX)) - cx
    const nearY = Math.max(minY, Math.min(cy, maxY)) - cy
    const nearZ = Math.max(minZ, Math.min(cz, maxZ)) - cz
    if (nearX * nearX + nearY * nearY + nearZ * nearZ > radius2) continue
    if (!prepareTetrahedron(corners, inverse, tetPlanes)) continue
    stats.sphereTets++
    stamp++
    const margin = 1e-3 * Math.max(maxX - minX, maxY - minY, maxZ - minZ)
    const range = [cellOf(minX, cx), cellOf(maxX, cx), cellOf(minY, cy), cellOf(maxY, cy), cellOf(minZ, cz), cellOf(maxZ, cz)]
    for (let x = range[0]; x <= range[1]; x++)
      for (let y = range[2]; y <= range[3]; y++)
        for (let z = range[4]; z <= range[5]; z++) {
          const cell = (x * GRID_SIZE + y) * GRID_SIZE + z
          for (let k = cellCounts[cell]; k < cellCounts[cell + 1]; k++) {
            const tri = cellTriangles[k]
            if (seen[tri] === stamp) continue
            seen[tri] = stamp
            const box = tri * 6
            if (
              triangleBoxes[box] > maxX + margin ||
              triangleBoxes[box + 1] < minX - margin ||
              triangleBoxes[box + 2] > maxY + margin ||
              triangleBoxes[box + 3] < minY - margin ||
              triangleBoxes[box + 4] > maxZ + margin ||
              triangleBoxes[box + 5] < minZ - margin
            )
              continue
            piece.count = 3
            loadCorner(piece, 0, sphereVertices, corners, inverse, unit.triangles[tri * 3])
            loadCorner(piece, 1, sphereVertices, corners, inverse, unit.triangles[tri * 3 + 1])
            loadCorner(piece, 2, sphereVertices, corners, inverse, unit.triangles[tri * 3 + 2])
            const sides = facesSides(piece, tetPlanes)
            if (sides === 0) continue
            let shape = piece
            for (let face = 0; face < 4 && shape.count >= 3 && sides !== 1; face++) {
              const target = shape === piece ? scratch : piece
              clipByPlane(shape, tetPlanes[face], target, SPHERE_EPS)
              shape = target
            }
            for (let p = 0; p < sphere.keep.length && shape.count >= 3; p++) {
              const target = shape === piece ? scratch : piece
              clipByPlane(shape, sphere.keep[p], target, SPHERE_EPS)
              shape = target
            }
            if (shape.count < 3) continue
            emitFan(output, shape, tet)
          }
        }
  }
  return viewCapOutput(output)
}

// ---------------------------------------------------------------------------------------------
// utils/clipping-cap-recipe.ts: the build, and the faces hidden inside another volume
// ---------------------------------------------------------------------------------------------
function isInsideVolume({ shape, inverse: e }, x, y, z) {
  const lx = e[0] * x + e[4] * y + e[8] * z + e[12]
  const ly = e[1] * x + e[5] * y + e[9] * z + e[13]
  const lz = e[2] * x + e[6] * y + e[10] * z + e[14]
  return shape === 'box' ? Math.max(Math.abs(lx), Math.abs(ly), Math.abs(lz)) < 1 : lx * lx + ly * ly + lz * lz < 1
}

export function dropHiddenCapFaces(parts, volumes, stats = {}) {
  stats.dropped = 0
  if (volumes.length === 0) return parts
  const faceCount = parts.indices.length / 3
  const kept = new Uint8Array(faceCount)
  let keptCount = 0
  for (let f = 0; f < faceCount; f++) {
    const owner = parts.vertexOwners[parts.indices[f * 3]]
    const hidden = volumes.some(volume => {
      if (volume.group === owner) return false
      for (let corner = 0; corner < 3; corner++) {
        const v = parts.indices[f * 3 + corner] * 3
        if (!isInsideVolume(volume, parts.positions[v], parts.positions[v + 1], parts.positions[v + 2])) return false
      }
      return true
    })
    if (hidden) continue
    kept[f] = 1
    keptCount++
  }
  stats.dropped = faceCount - keptCount
  if (keptCount === faceCount) return parts
  const output = makeCapOutput()
  const remap = new Int32Array(parts.positions.length / 3).fill(-1)
  const corners = [0, 0, 0]
  for (let f = 0; f < faceCount; f++) {
    if (!kept[f]) continue
    for (let corner = 0; corner < 3; corner++) {
      const v = parts.indices[f * 3 + corner]
      if (remap[v] < 0) {
        output.owner = parts.vertexOwners[v]
        remap[v] = emitVertex(output, parts.positions[v * 3], parts.positions[v * 3 + 1], parts.positions[v * 3 + 2], parts.vertexTets[v], parts.weights, v * 4)
      }
      corners[corner] = remap[v]
    }
    output.section = parts.faceSections[f]
    emitFace(output, corners[0], corners[1], corners[2], parts.capFaceTetrahedronIndices[f])
  }
  return viewCapOutput(output)
}

const SPHERE_SLAB_PLANE = { normal: { x: 1, y: 0, z: 0 }, constant: 0 }

export function buildRecipeCapParts(positions, indices, recipe, slabIndicesFor = planes => planes.map(() => null), options = {}) {
  const stats = {}
  const slabIndices = slabIndicesFor([...recipe.sections.map(section => section.plane), ...recipe.spheres.map(() => SPHERE_SLAB_PLANE)])
  stats.indexedSections = slabIndices.filter(Boolean).length
  const sections = buildSectionCapParts(
    positions,
    indices,
    recipe.sections.map((section, index) => ({ ...section, slabIndex: slabIndices[index] })),
    stats,
    0
  )
  const spheres = recipe.spheres.map((sphere, index) =>
    buildSphereCapParts(positions, indices, sphere, slabIndices[recipe.sections.length + index], stats, recipe.sections.length + index, options.icosphereLevel ?? 5)
  )
  const merged = mergeCapParts([sections, ...spheres])
  stats.beforeDrop = merged.indices.length / 3
  const parts = options.dropHidden === false ? merged : dropHiddenCapFaces(merged, recipe.volumes, stats)
  return { parts, stats, slabIndices }
}

/** Interpolates a nodal field at the cap vertices: a weighted sum of the 4 nodal values. */
export function interpolateCapValues(parts, indices, values) {
  const { vertexTets, weights } = parts
  const result = new Float32Array(vertexTets.length)
  for (let v = 0; v < vertexTets.length; v++) {
    const offset = vertexTets[v] * 4
    let sum = 0
    for (let c = 0; c < 4; c++) sum += weights[v * 4 + c] * values[indices[offset + c]]
    result[v] = sum
  }
  return result
}

// ---------------------------------------------------------------------------------------------
// clipping/clipping-outline.ts
// ---------------------------------------------------------------------------------------------
const OUTLINE_EPS = 1e-9
const CIRCLE_SEGMENTS = 96
const CIRCLE_COS = Float64Array.from({ length: CIRCLE_SEGMENTS + 1 }, (_, s) => Math.cos((s / CIRCLE_SEGMENTS) * Math.PI * 2))
const CIRCLE_SIN = Float64Array.from({ length: CIRCLE_SEGMENTS + 1 }, (_, s) => Math.sin((s / CIRCLE_SEGMENTS) * Math.PI * 2))
const crossing = [new THREE.Vector3(), new THREE.Vector3()]
const keptRange = [0, 1]

function crossEdge(p, q, dp, dq, count) {
  if (!(dp * dq < 0)) return count
  if (count < 2) crossing[count].lerpVectors(p, q, dp / (dp - dq))
  return count + 1
}
const snapToPlane = d => (Math.abs(d) < OUTLINE_EPS ? 0 : d)
function touchVertex(p, d, count) {
  if (d !== 0) return count
  if (count < 2) crossing[count].copy(p)
  return count + 1
}

export function crossPlane(plane, a, b, c) {
  const da = snapToPlane(plane.distanceToPoint(a))
  const db = snapToPlane(plane.distanceToPoint(b))
  const dc = snapToPlane(plane.distanceToPoint(c))
  let count = touchVertex(a, da, 0)
  count = touchVertex(b, db, count)
  count = touchVertex(c, dc, count)
  if (count === 3) return false
  if (count === 2) return da + db + dc > 0
  count = crossEdge(a, b, da, db, count)
  count = crossEdge(b, c, db, dc, count)
  count = crossEdge(c, a, dc, da, count)
  return count === 2
}
export const crossingPoints = () => [crossing[0].clone(), crossing[1].clone()]

/** Liang-Barsky: the part of p..q inside every half-space f <= 0, as the range [t0, t1]. */
function clipSegment(p, q, halfSpaces) {
  let t0 = 0
  let t1 = 1
  for (const { normal, constant } of halfSpaces) {
    const fp = normal.dot(p) + constant
    const fq = normal.dot(q) + constant
    if (fp > 0 && fq > 0) return false
    if (fp <= 0 && fq <= 0) continue
    const t = fp / (fp - fq)
    if (fp > 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return false
  }
  keptRange[0] = t0
  keptRange[1] = t1
  return true
}

const segmentStart = new THREE.Vector3()
const segmentEnd = new THREE.Vector3()
function pushKept(p, q, out) {
  segmentStart.lerpVectors(p, q, keptRange[0])
  segmentEnd.lerpVectors(p, q, keptRange[1])
  out.push(segmentStart.x, segmentStart.y, segmentStart.z, segmentEnd.x, segmentEnd.y, segmentEnd.z)
}

const sphereNormal = new THREE.Vector3()
const sphereScratch = new THREE.Vector3()
const circleCenter = new THREE.Vector3()
const circleU = new THREE.Vector3()
const circleV = new THREE.Vector3()
const circlePoints = [new THREE.Vector3(), new THREE.Vector3()]
const triangleEdges = [0, 1, 2].map(() => ({ normal: new THREE.Vector3(), constant: 0 }))
function writeTriangleEdge(edge, from, to, normal) {
  edge.normal.subVectors(to, from).cross(normal).normalize()
  edge.constant = -edge.normal.dot(from)
}

// The app also skips the steps outside the wedge the triangle spans; the result is the same.
function appendSphereCrossings(center, radius, a, b, c, out) {
  const inside = radius * radius - OUTLINE_EPS
  if (a.distanceToSquared(center) < inside && b.distanceToSquared(center) < inside && c.distanceToSquared(center) < inside) return
  const normal = sphereNormal.subVectors(b, a).cross(sphereScratch.subVectors(c, a))
  const area = normal.length()
  if (area < OUTLINE_EPS) return
  normal.divideScalar(area)
  const distance = normal.dot(sphereScratch.subVectors(center, a))
  if (Math.abs(distance) >= radius) return
  circleCenter.copy(center).addScaledVector(normal, -distance)
  const circleRadius = Math.sqrt(radius * radius - distance * distance)
  const box = new THREE.Box3().expandByPoint(a).expandByPoint(b).expandByPoint(c)
  if (!box.expandByScalar(circleRadius).containsPoint(circleCenter)) return
  writeTriangleEdge(triangleEdges[0], a, b, normal)
  writeTriangleEdge(triangleEdges[1], b, c, normal)
  writeTriangleEdge(triangleEdges[2], c, a, normal)
  for (const edge of triangleEdges) if (edge.normal.dot(circleCenter) + edge.constant > circleRadius * (1 + 1e-6) + OUTLINE_EPS) return
  const u = circleU.subVectors(a, circleCenter)
  if (u.lengthSq() < OUTLINE_EPS) u.subVectors(b, circleCenter)
  u.addScaledVector(normal, -normal.dot(u)).normalize()
  circleV.crossVectors(normal, u)
  for (let step = 1; step <= CIRCLE_SEGMENTS; step++) {
    const previous = circlePoints[0].copy(circleCenter).addScaledVector(circleU, CIRCLE_COS[step - 1] * circleRadius).addScaledVector(circleV, CIRCLE_SIN[step - 1] * circleRadius)
    const next = circlePoints[1].copy(circleCenter).addScaledVector(circleU, CIRCLE_COS[step] * circleRadius).addScaledVector(circleV, CIRCLE_SIN[step] * circleRadius)
    if (clipSegment(previous, next, triangleEdges)) pushKept(previous, next, out)
  }
}

export function outlineCutterOf(element) {
  if (element.shape === 'plane') {
    const plane = writeClippingPlane(element, new THREE.Plane())
    return (a, b, c, out) => {
      if (crossPlane(plane, a, b, c)) out.push(crossing[0].x, crossing[0].y, crossing[0].z, crossing[1].x, crossing[1].y, crossing[1].z)
    }
  }
  let cutVolume
  if (element.shape === 'box') {
    const faces = clippingBoxFacePlanes(element)
    const others = faces.map((_, index) => faces.filter((_, other) => other !== index))
    cutVolume = (a, b, c, out) => {
      for (let index = 0; index < faces.length; index++) {
        if (!crossPlane(faces[index], a, b, c)) continue
        if (clipSegment(crossing[0], crossing[1], others[index])) pushKept(crossing[0], crossing[1], out)
      }
    }
  } else {
    const center = new THREE.Vector3(...element.center)
    const radius = element.size[0] / 2
    cutVolume = (a, b, c, out) => appendSphereCrossings(center, radius, a, b, c, out)
  }
  const { min, max } = expandBoxByClippingElement(new THREE.Box3(), element).expandByScalar(1e-6 * Math.max(...element.size) + OUTLINE_EPS)
  return (a, b, c, out) => {
    if (
      Math.max(a.x, b.x, c.x) < min.x || Math.min(a.x, b.x, c.x) > max.x ||
      Math.max(a.y, b.y, c.y) < min.y || Math.min(a.y, b.y, c.y) > max.y ||
      Math.max(a.z, b.z, c.z) < min.z || Math.min(a.z, b.z, c.z) > max.z
    )
      return
    cutVolume(a, b, c, out)
  }
}

/** `mode` 'intersection' is DEMO: a segment stays when every other element removes its middle. */
export function outlineSegmentsOf(elements, positions, surface, { mode = 'union', margin = CLIP_VOLUME_MARGIN } = {}) {
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const all = []
  const middle = new THREE.Vector3()
  elements.forEach(element => {
    const segments = []
    const cut = outlineCutterOf(element)
    for (let t = 0; t < surface.length / 3; t++) {
      a.fromArray(positions, surface[t * 3] * 3)
      b.fromArray(positions, surface[t * 3 + 1] * 3)
      c.fromArray(positions, surface[t * 3 + 2] * 3)
      cut(a, b, c, segments)
    }
    const others = elements.filter(other => other !== element)
    for (let i = 0; i < segments.length; i += 6) {
      middle.set((segments[i] + segments[i + 3]) / 2, (segments[i + 1] + segments[i + 4]) / 2, (segments[i + 2] + segments[i + 5]) / 2)
      const keep =
        mode === 'intersection'
          ? others.every(other => clippingElementRemoves(other, middle, margin))
          : !others.some(other => clippingElementRemoves(other, middle, margin))
      if (keep) for (let k = 0; k < 6; k++) all.push(segments[i + k])
    }
  })
  return new Float32Array(all)
}
