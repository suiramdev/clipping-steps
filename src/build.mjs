// Bundles src/ with three.js into one self-contained index.html (works from file://).
// usage: node build.mjs <path to a node_modules that holds three and esbuild>
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const nodeModules = process.argv[2]
const require = createRequire(join(nodeModules, 'noop.js'))
const esbuild = require(process.argv[3] ?? 'esbuild')

const result = await esbuild.build({
  entryPoints: [join(here, 'main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2022',
  nodePaths: [nodeModules],
  legalComments: 'none',
  logLevel: 'warning',
})
const js = result.outputFiles[0].text.replaceAll('</script', '<\\/script')
const html = readFileSync(join(here, 'index.html'), 'utf8')
const out = html.replace('<script>/*__BUNDLE__*/</script>', () => `<script>\n${js}\n</script>`)
writeFileSync(join(here, '..', 'index.html'), out)
console.log(`index.html: ${(out.length / 1024).toFixed(0)} KiB`)
