/**
 * Graphify core extension for Aery.
 *
 * On session start:
 *   - If graphify-out/graph.json exists, reads GRAPH_REPORT.md and injects
 *     god nodes + community summary into every LLM context call.
 *   - Registers query_graph, god_nodes, graph_path as agent tools.
 *
 * On file write/edit:
 *   - Debounces and triggers incremental AST update for code files.
 *   - Writes .needs_update flag for doc/image changes (requires manual --update).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@eminent337/aery";

const GRAPH_JSON = "graphify-out/graph.json";
const GRAPH_REPORT = "graphify-out/GRAPH_REPORT.md";
const GRAPHIFY_PYTHON = "graphify-out/.graphify_python";
const NEEDS_UPDATE = "graphify-out/.needs_update";
const DEBOUNCE_MS = 3000;

const CODE_EXTS = new Set([".ts", ".js", ".mjs", ".py", ".go", ".rs", ".java", ".cpp", ".c", ".rb", ".swift", ".kt", ".cs"]);

function graphExists(cwd: string): boolean {
	return existsSync(join(cwd, GRAPH_JSON));
}

function getPython(cwd: string): string | null {
	const p = join(cwd, GRAPHIFY_PYTHON);
	return existsSync(p) ? readFileSync(p, "utf-8").trim() : null;
}

function extractGraphSummary(cwd: string): string | null {
	const reportPath = join(cwd, GRAPH_REPORT);
	if (!existsSync(reportPath)) return null;
	const content = readFileSync(reportPath, "utf-8");
	const sections: string[] = [];
	for (const heading of ["God Nodes", "Surprising Connections"]) {
		const start = content.indexOf(`## ${heading}`);
		if (start === -1) continue;
		const end = content.indexOf("\n## ", start + 1);
		sections.push(end === -1 ? content.slice(start) : content.slice(start, end));
	}
	return sections.length ? `<graphify>\n${sections.join("\n\n").trim()}\n</graphify>` : null;
}

function runPython(python: string, code: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(python, ["-c", code], { timeout: 30_000 });
		let out = "";
		let err = "";
		proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
		proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });
		proc.on("close", (code: number) => {
			code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`));
		});
	});
}

function graphJsonPath(cwd: string): string {
	return join(cwd, GRAPH_JSON).replace(/\\/g, "\\\\");
}

export default function (aery: ExtensionAPI) {
	let graphSummary: string | null = null;
	let cwd = process.cwd();
	let pendingUpdate: ReturnType<typeof setTimeout> | null = null;
	const pendingFiles = new Set<string>();

	// ── Session start ─────────────────────────────────────────────────────────
	aery.on("session_start", async (_event, _ctx) => {
		cwd = process.cwd();
		if (!graphExists(cwd)) return;
		graphSummary = extractGraphSummary(cwd);

		const python = getPython(cwd);
		if (!python) return;
		const gPath = graphJsonPath(cwd);

		// query_graph
		aery.registerTool({
			name: "query_graph",
			label: "Query Knowledge Graph",
			description: "Search the project knowledge graph by concept. Returns connected nodes and edges.",
			promptSnippet: "query_graph(question, mode?) — search the knowledge graph (bfs=broad, dfs=trace path)",
			parameters: Type.Object({
				question: Type.String({ description: "Concept or question to search for" }),
				mode: Type.Optional(Type.Union([Type.Literal("bfs"), Type.Literal("dfs")])),
			}),
			async execute(_id, params, _signal, _onUpdate, _ctx) {
				const mode = params.mode ?? "bfs";
				try {
					const result = await runPython(python, `
import json, sys
from networkx.readwrite import json_graph
import networkx as nx
from pathlib import Path
G = json_graph.node_link_graph(json.loads(Path('${gPath}').read_text()), edges='links')
terms = [t.lower() for t in ${JSON.stringify(params.question)}.split() if len(t) > 3]
scored = sorted([(sum(1 for t in terms if t in G.nodes[n].get('label','').lower()), n) for n in G.nodes()], reverse=True)
starts = [n for _,n in scored[:3] if _ > 0]
if not starts: print('No matching nodes.'); sys.exit(0)
nodes = set(starts); edges = []
if '${mode}' == 'dfs':
    visited = set(); stack = [(n,0) for n in reversed(starts)]
    while stack:
        n,d = stack.pop()
        if n in visited or d > 6: continue
        visited.add(n); nodes.add(n)
        for nb in G.neighbors(n):
            if nb not in visited: stack.append((nb,d+1)); edges.append((n,nb))
else:
    frontier = set(starts)
    for _ in range(3):
        nxt = set()
        for n in frontier:
            for nb in G.neighbors(n):
                if nb not in nodes: nxt.add(nb); edges.append((n,nb))
        nodes.update(nxt); frontier = nxt
lines = [f'${mode.toUpperCase()} | {len(nodes)} nodes']
for n in sorted(nodes, key=lambda n: sum(1 for t in terms if t in G.nodes[n].get('label','').lower()), reverse=True)[:50]:
    d = G.nodes[n]; lines.append(f'  NODE {d.get("label",n)} [{d.get("source_file","")}:{d.get("source_location","")}]')
for u,v in edges[:100]:
    if u in nodes and v in nodes:
        e = G.edges[u,v]; lines.append(f'  EDGE {G.nodes[u].get("label",u)} --{e.get("relation","")} [{e.get("confidence","")}]--> {G.nodes[v].get("label",v)}')
print('\\n'.join(lines))
`);
					return { type: "success", output: result };
				} catch (e) {
					return { type: "error", output: String(e) };
				}
			},
		});

		// god_nodes
		aery.registerTool({
			name: "god_nodes",
			label: "Graph God Nodes",
			description: "Returns the most connected nodes in the knowledge graph — the concepts everything else depends on.",
			promptSnippet: "god_nodes(limit?) — get the highest-degree concepts in the codebase",
			parameters: Type.Object({
				limit: Type.Optional(Type.Number({ description: "Max results. Default: 10" })),
			}),
			async execute(_id, params, _signal, _onUpdate, _ctx) {
				try {
					const result = await runPython(python, `
import json
from networkx.readwrite import json_graph
import networkx as nx
from pathlib import Path
G = json_graph.node_link_graph(json.loads(Path('${gPath}').read_text()), edges='links')
for n in sorted(G.nodes(), key=lambda n: G.degree(n), reverse=True)[:${params.limit ?? 10}]:
    d = G.nodes[n]; print(f'{d.get("label",n)} (degree={G.degree(n)}, file={d.get("source_file","")})')
`);
					return { type: "success", output: result };
				} catch (e) {
					return { type: "error", output: String(e) };
				}
			},
		});

		// graph_path
		aery.registerTool({
			name: "graph_path",
			label: "Graph Shortest Path",
			description: "Find the shortest path between two concepts in the knowledge graph.",
			promptSnippet: "graph_path(from, to) — trace how two concepts connect",
			parameters: Type.Object({
				from: Type.String({ description: "Source concept" }),
				to: Type.String({ description: "Target concept" }),
			}),
			async execute(_id, params, _signal, _onUpdate, _ctx) {
				try {
					const result = await runPython(python, `
import json, sys
import networkx as nx
from networkx.readwrite import json_graph
from pathlib import Path
G = json_graph.node_link_graph(json.loads(Path('${gPath}').read_text()), edges='links')
def find(term):
    t = term.lower()
    s = sorted([(sum(1 for w in t.split() if w in G.nodes[n].get('label','').lower()), n) for n in G.nodes()], reverse=True)
    return s[0][1] if s and s[0][0] > 0 else None
src, tgt = find(${JSON.stringify(params.from)}), find(${JSON.stringify(params.to)})
if not src or not tgt: print('Could not find matching nodes.'); sys.exit(0)
try:
    path = nx.shortest_path(G, src, tgt)
    print(f'Shortest path ({len(path)-1} hops):')
    for i,n in enumerate(path):
        label = G.nodes[n].get('label',n)
        if i < len(path)-1:
            e = G.edges[n,path[i+1]]; print(f'  {label} --{e.get("relation","")} [{e.get("confidence","")}]-->')
        else: print(f'  {label}')
except nx.NetworkXNoPath: print('No path found.')
`);
					return { type: "success", output: result };
				} catch (e) {
					return { type: "error", output: String(e) };
				}
			},
		});
	});

	// ── Context injection ─────────────────────────────────────────────────────
	aery.on("context", (event, _ctx) => {
		if (!graphSummary) return undefined;
		return {
			messages: [
				{ role: "user" as const, content: graphSummary },
				{ role: "assistant" as const, content: "Understood. I have the project knowledge graph loaded and will use it when answering architecture or dependency questions." },
				...event.messages,
			],
		};
	});

	// ── Incremental update on file writes ─────────────────────────────────────
	aery.on("tool_result", (event, _ctx) => {
		if (!["write", "edit"].includes(event.toolName)) return;
		if (!graphExists(cwd)) return;

		const path = event.input?.path as string | undefined;
		if (!path) return;

		pendingFiles.add(path);
		if (pendingUpdate) clearTimeout(pendingUpdate);
		pendingUpdate = setTimeout(async () => {
			pendingUpdate = null;
			const python = getPython(cwd);
			if (!python) return;

			const files = Array.from(pendingFiles);
			pendingFiles.clear();

			const allCode = files.every(f => CODE_EXTS.has(f.slice(f.lastIndexOf("."))));

			if (!allCode) {
				// Semantic re-extraction needed — flag for manual /graphify --update
				writeFileSync(join(cwd, NEEDS_UPDATE), files.join("\n"));
				return;
			}

			try {
				await runPython(python, `
import json
from graphify.extract import extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json
from networkx.readwrite import json_graph
from pathlib import Path

files = [Path(f) for f in ${JSON.stringify(files)} if Path(f).exists()]
if not files: raise SystemExit(0)

result = extract(files)
G_new = build_from_json(result)

existing = json.loads(Path('${graphJsonPath(cwd)}').read_text())
import networkx as nx
G = json_graph.node_link_graph(existing, edges='links')
G.update(G_new)

communities = cluster(G)
cohesion = score_all(G, communities)
gods = god_nodes(G)
surprises = surprising_connections(G, communities)
labels = {cid: 'Community ' + str(cid) for cid in communities}
questions = suggest_questions(G, communities, labels)
detection = {'total_files': G.number_of_nodes(), 'total_words': 0, 'files': {}}
tokens = {'input': 0, 'output': 0}
report = generate(G, communities, cohesion, labels, gods, surprises, detection, tokens, '.', suggested_questions=questions)
Path('${join(cwd, GRAPH_REPORT).replace(/\\/g, "\\\\")}').write_text(report)
to_json(G, communities, '${graphJsonPath(cwd)}')
print(f'Graph updated: {G.number_of_nodes()} nodes')
`);
				// Refresh in-memory summary
				graphSummary = extractGraphSummary(cwd);
			} catch {
				// Best-effort — silent failure
			}
		}, DEBOUNCE_MS);
	});
}
