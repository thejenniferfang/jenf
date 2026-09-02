// Dev server for jenf: serves the static site and mounts ui-agent over it.
// Not used in production. Vercel serves the plain files.
//
//   node dev/serve.mjs            -> http://localhost:4177
//   PORT=5000 node dev/serve.mjs
//
// The panel is injected into every HTML page. Token edits are written back to
// style.css by @jenfang/ui-agent's server, and every decision is appended to
// ui-decisions.jsonl at the repo root.

import http from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const uiAgentDir = process.env.UI_AGENT_DIR ?? path.resolve(root, "../ui-agent")
const port = Number(process.env.PORT ?? 4177)
// Agentation server, so findings and nudges can be handed to a coding agent.
const agentEndpoint = process.env.AGENT_ENDPOINT ?? "http://localhost:4747"

const { createThemeWriter, handleThemeRequest, createFindingStore, handleFindingRequest } =
  await import(path.join(uiAgentDir, "dist/server.js"))

const recordDecision = createThemeWriter({
  stylesheet: path.join(root, "style.css"),
  decisionLog: path.join(root, "ui-decisions.jsonl"),
  cwd: root,
})
const findings = createFindingStore({ decisionLog: path.join(root, "ui-decisions.jsonl") })

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
}

// Everything the panel needs, appended before </body>. React comes from esm.sh
// the same way the package's own harness does, and the panel itself is served
// straight from the sibling ui-agent checkout, so a rebuild there shows up on
// reload here.
const panel = `
<div id="ui-agent-root"></div>
<script type="importmap">
{"imports":{
  "react":"https://esm.sh/react@19.0.0",
  "react-dom":"https://esm.sh/react-dom@19.0.0",
  "react-dom/client":"https://esm.sh/react-dom@19.0.0/client",
  "react/jsx-runtime":"https://esm.sh/react@19.0.0/jsx-runtime"
}}
</script>
<script type="module">
  import { createElement } from "react"
  import { createRoot } from "react-dom/client"
  import { UiAgent } from "/__ui-agent/index.js"

  const css = await fetch("/style.css").then((r) => r.text())
  const committed = (variable) => {
    const m = css.match(new RegExp(variable + "\\\\s*:\\\\s*([^;]+);"))
    return m ? m[1].trim() : ""
  }
  const token = (key, variable, unit, utilities = []) => ({
    key, variable, unit, utilities, committed: committed(variable),
  })

  const groups = [
    { name: "space", min: 0, max: 120, step: 2, tokens: [
      token("row", "--space-row", "px", [".projects li"]),
      token("section", "--space-section", "px", ["h2"]),
      token("page", "--space-page", "px", ["main"]),
      token("code", "--space-code", "px", ["pre"]),
    ]},
    { name: "radius", min: 0, max: 12, step: 1, tokens: [
      token("code", "--radius-code", "px", ["code", "pre"]),
      token("link", "--radius-link", "px", ["a:hover"]),
    ]},
    { name: "motion", min: 0, max: 600, step: 10, tokens: [
      token("hover", "--motion-hover", "ms", ["a"]),
    ]},
  ]

  createRoot(document.getElementById("ui-agent-root")).render(
    createElement(UiAgent, {
      groups,
      endpoint: "/api/ui-agent",
      surface: "jenf",
      source: "style.css",
      sourceEndpoint: null,
      agentEndpoint: ${JSON.stringify(agentEndpoint)},
      typography: { scale: [15, 16, 17, 24, 32], banMonoUppercase: true },
      alignment: { grid: 2, tolerance: 4 },
    }),
  )
</script>
`

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString("utf8")
  return raw ? JSON.parse(raw) : {}
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type })
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

async function serveFile(res, file, inject) {
  let data
  try {
    data = await fs.readFile(file)
  } catch {
    return send(res, 404, "Not found", "text/plain")
  }
  const ext = path.extname(file)
  if (ext === ".html" && inject) {
    const html = data.toString("utf8").replace("</body>", `${panel}</body>`)
    return send(res, 200, html, types[".html"])
  }
  send(res, 200, data, types[ext] ?? "application/octet-stream")
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`)
  const p = url.pathname

  try {
    if (p === "/api/ui-agent" && req.method === "POST") {
      const { status, body } = await handleThemeRequest(await readBody(req), recordDecision)
      return send(res, status, body)
    }
    if (p === "/api/ui-agent/findings") {
      if (req.method === "GET") return send(res, 200, { accepted: await findings.accepted() })
      if (req.method === "POST") {
        const { status, body } = await handleFindingRequest(await readBody(req), findings)
        return send(res, status, body)
      }
    }
    if (p.startsWith("/__ui-agent/")) {
      const rel = p.slice("/__ui-agent/".length)
      return serveFile(res, path.join(uiAgentDir, "dist", path.normalize(rel)), false)
    }

    // Static site, with Vercel's cleanUrls behaviour: /ui-agent -> ui-agent/index.html
    let rel = path.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, "")
    let file = path.join(root, rel)
    if (rel.endsWith("/") || rel === ".") file = path.join(file, "index.html")
    else if (!path.extname(rel)) {
      const asDir = path.join(file, "index.html")
      const asHtml = `${file}.html`
      file = (await fs.stat(asDir).catch(() => null)) ? asDir : asHtml
    }
    if (!file.startsWith(root)) return send(res, 403, "Forbidden", "text/plain")
    return serveFile(res, file, true)
  } catch (error) {
    console.error(error)
    send(res, 500, { error: error instanceof Error ? error.message : "Server error" })
  }
})

server.listen(port, "127.0.0.1", () => {
  console.log(`jenf dev server with ui-agent: http://localhost:${port}`)
  console.log(`panel from ${uiAgentDir}/dist, writing tokens to ${path.join(root, "style.css")}`)
})
