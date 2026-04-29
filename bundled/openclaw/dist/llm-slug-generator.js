import "./paths-CyR9Pa1R.js";
import "./workspace-CAwOqECe.js";
import "./exec-kNgoQ-Yt.js";
import { c as resolveDefaultAgentId, r as resolveAgentDir, s as resolveAgentWorkspaceDir } from "./agent-scope-mFm05wNX.js";
import "./deliver-Bthh_5Hw.js";
import { t as runEmbeddedPiAgent } from "./pi-embedded-CM97XTkp.js";
import "./image-ops-Db3kwMRr.js";
import "./boolean-Bb19hm9Y.js";
import "./model-auth-Bos4xjOH.js";
import "./config-Dr8z937s.js";
import "./send-B9hfQuuv.js";
import "./send-DqFR2tga.js";
import "./send-BA6n3AqM.js";
import "./github-copilot-token-BXEGgIt5.js";
import "./pi-model-discovery-Cexg1XRf.js";
import "./pi-embedded-helpers-CUD7UoUC.js";
import "./chrome-BaJk80VF.js";
import "./frontmatter-yyc9d0b4.js";
import "./store-Bx3kRvoj.js";
import "./paths-Ck4L046D.js";
import "./tool-images-BomM11M6.js";
import "./image-Drpoo6S0.js";
import "./manager-NQW5XhE3.js";
import "./sqlite-C54NeA1C.js";
import "./retry-BRz5KYcW.js";
import "./redact-DcuzVizL.js";
import "./common-Cea6Ar7H.js";
import "./ir-CGoC6GyL.js";
import "./fetch-DNxVU_z5.js";
import "./render-CiikiGbn.js";
import "./runner-CfRx2Ecl.js";
import "./send-CURnSuQc.js";
import "./send-h0_uAQzq.js";
import "./channel-activity-BOEKbbU8.js";
import "./tables-DNz0QRDt.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

//#region src/hooks/llm-slug-generator.ts
/**
* LLM-based slug generator for session memory filenames
*/
/**
* Generate a short 1-2 word filename slug from session content using LLM
*/
async function generateSlugViaLLM(params) {
	let tempSessionFile = null;
	try {
		const agentId = resolveDefaultAgentId(params.cfg);
		const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
		const agentDir = resolveAgentDir(params.cfg, agentId);
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-slug-"));
		tempSessionFile = path.join(tempDir, "session.jsonl");
		const prompt = `Based on this conversation, generate a short 1-2 word filename slug (lowercase, hyphen-separated, no file extension).

Conversation summary:
${params.sessionContent.slice(0, 2e3)}

Reply with ONLY the slug, nothing else. Examples: "vendor-pitch", "api-design", "bug-fix"`;
		const result = await runEmbeddedPiAgent({
			sessionId: `slug-generator-${Date.now()}`,
			sessionKey: "temp:slug-generator",
			agentId,
			sessionFile: tempSessionFile,
			workspaceDir,
			agentDir,
			config: params.cfg,
			prompt,
			timeoutMs: 15e3,
			runId: `slug-gen-${Date.now()}`
		});
		if (result.payloads && result.payloads.length > 0) {
			const text = result.payloads[0]?.text;
			if (text) return text.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || null;
		}
		return null;
	} catch (err) {
		console.error("[llm-slug-generator] Failed to generate slug:", err);
		return null;
	} finally {
		if (tempSessionFile) try {
			await fs.rm(path.dirname(tempSessionFile), {
				recursive: true,
				force: true
			});
		} catch {}
	}
}

//#endregion
export { generateSlugViaLLM };