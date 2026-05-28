import * as fs from "node:fs";
import * as path from "node:path";

export interface GraphNode {
	id: string;
	label: string;
	file: string;
	degree: number;
}

export interface GraphEdge {
	source: string;
	target: string;
}

export class NativeGraphEngine {
	private nodes = new Map<string, GraphNode>();
	private adjacencyList = new Map<string, Set<string>>();

	constructor(private workspaceDir: string) {}

	public buildGraph(): void {
		this.nodes.clear();
		this.adjacencyList.clear();

		const files = this.scanDir(this.workspaceDir);
		for (const file of files) {
			this.addNode(file);
			this.parseImports(file);
		}

		// Calculate degree for all nodes (in + out edges)
		for (const [nodeId, edges] of this.adjacencyList.entries()) {
			const node = this.nodes.get(nodeId);
			if (node) {
				node.degree += edges.size;
				for (const targetId of edges) {
					const targetNode = this.nodes.get(targetId);
					if (targetNode) {
						targetNode.degree += 1;
					}
				}
			}
		}
	}

	public getGodNodes(limit: number = 10): GraphNode[] {
		return Array.from(this.nodes.values())
			.sort((a, b) => b.degree - a.degree)
			.slice(0, limit);
	}

	public getShortestPath(sourceId: string, targetId: string): string[] | null {
		// Standard BFS for shortest path
		if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) return null;

		const queue = [[sourceId]];
		const visited = new Set<string>([sourceId]);

		while (queue.length > 0) {
			const path = queue.shift()!;
			const current = path[path.length - 1];

			if (current === targetId) return path;

			const neighbors = this.adjacencyList.get(current) || new Set();
			for (const neighbor of neighbors) {
				if (!visited.has(neighbor)) {
					visited.add(neighbor);
					queue.push([...path, neighbor]);
				}
			}
		}

		return null;
	}

	private scanDir(dir: string): string[] {
		let results: string[] = [];
		try {
			const list = fs.readdirSync(dir);
			for (const file of list) {
				const fullPath = path.join(dir, file);
				const stat = fs.statSync(fullPath);
				if (stat && stat.isDirectory()) {
					if (!file.includes("node_modules") && !file.includes(".git") && !file.includes("dist")) {
						results = results.concat(this.scanDir(fullPath));
					}
				} else if (file.endsWith(".ts") || file.endsWith(".js")) {
					results.push(fullPath);
				}
			}
		} catch (e) {
			// Ignore read errors
		}
		return results;
	}

	private addNode(filePath: string): string {
		const id = path.basename(filePath);
		if (!this.nodes.has(id)) {
			this.nodes.set(id, { id, label: id, file: filePath, degree: 0 });
		}
		if (!this.adjacencyList.has(id)) {
			this.adjacencyList.set(id, new Set());
		}
		return id;
	}

	private parseImports(filePath: string): void {
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const sourceId = this.addNode(filePath);

			// Extremely fast & simple regex for native TS/JS imports
			const importRegex = /import\s+.*?from\s+['"](.*?)['"]/g;
			let match;
			while ((match = importRegex.exec(content)) !== null) {
				const importPath = match[1];
				// Very basic resolution for relative paths
				if (importPath.startsWith(".")) {
					const resolvedTarget = path.basename(importPath) + (importPath.endsWith(".ts") ? "" : ".ts");
					// Create edge
					const targetId = resolvedTarget;
					if (!this.nodes.has(targetId)) {
						this.nodes.set(targetId, { id: targetId, label: targetId, file: importPath, degree: 0 });
					}
					this.adjacencyList.get(sourceId)?.add(targetId);
				}
			}
		} catch (e) {
			// ignore read errors
		}
	}
}
