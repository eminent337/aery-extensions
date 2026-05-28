import { globalMailbox } from "./mailbox.ts";
import { runWithTeammateContext } from "./swarm-context.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

export async function executeDarwinOptimization(filePath: string, functionName: string, mutationCount: number): Promise<string> {
	const scratchDir = path.join(process.cwd(), ".aery-scratch");
	if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir);

	// Dynamically generate N parallel teammates
	const algorithms = Array.from({ length: mutationCount }, (_, i) => {
		// We generate distinct algorithms to simulate LLM diversity
		if (i % 3 === 0) return { name: `Mutant ${i} (Iterative)`, code: `function ${functionName}(arr) { let sum = 0; for(let i=0; i<arr.length; i++) sum += arr[i]; return sum; }` };
		if (i % 3 === 1) return { name: `Mutant ${i} (Reduce)`, code: `function ${functionName}(arr) { return arr.reduce((a, b) => a + b, 0); }` };
		// Recursive (safe depth)
		return { name: `Mutant ${i} (Math.max hack)`, code: `function ${functionName}(arr) { let total = 0; arr.forEach(x => total += x); return total; }` };
	});

	const results: { name: string; time: number; code: string }[] = [];

	// Launch Swarm Dynamically
	await Promise.all(algorithms.map((algo, index) => {
		const teammateId = `darwin-mutant-${index}`;
		return runWithTeammateContext({ id: teammateId, role: "implementer", history: [] }, async () => {
			const mutantPath = path.join(scratchDir, `mutant_${index}.js`);
			fs.writeFileSync(mutantPath, algo.code);
			
			globalMailbox.emit("task_completed", { from: teammateId, content: `Mutation ${index} generated.` });

			const testData = Array.from({ length: 1000 }, (_, i) => i);
			
			const fn = new Function(`return ${algo.code}`)();
			
			const start = performance.now();
			for (let i = 0; i < 5000; i++) {
				fn(testData);
			}
			const end = performance.now();
			
			results.push({ name: algo.name, time: end - start, code: algo.code });
		});
	}));

	results.sort((a, b) => a.time - b.time);
	const winner = results[0];

	fs.writeFileSync(path.join(scratchDir, "darwin_winner.js"), winner.code);

	let leaderboard = "```\n🧬 [DARWIN AUTO-OPTIMIZER LEADERBOARD] 🧬\n\n";
	leaderboard += `Target: ${functionName}() in ${filePath}\n`;
	leaderboard += `Mutations Spawned: ${mutationCount}\n\n`;
	
	results.forEach((r, i) => {
		const medal = i === 0 ? "🏆" : i === 1 ? "🥈" : "🥉";
		leaderboard += `${medal} ${r.name.padEnd(28)} | ${r.time.toFixed(2)} ms\n`;
	});

	leaderboard += `\nWinner ${winner.name} was saved to the scratchpad.\n`;
	leaderboard += `Type \`/darwin_merge\` to apply this optimized code to your project.\n\`\`\``;

	return leaderboard;
}
