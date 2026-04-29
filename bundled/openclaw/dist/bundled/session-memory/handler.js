import { s as resolveStateDir } from "../../paths-CyR9Pa1R.js";
import { E as resolveAgentIdFromSessionKey } from "../../workspace-CAwOqECe.js";
import { l as createSubsystemLogger } from "../../exec-kNgoQ-Yt.js";
import { s as resolveAgentWorkspaceDir } from "../../agent-scope-mFm05wNX.js";
import "../../deliver-Bthh_5Hw.js";
import { Z as hasInterSessionUserProvenance } from "../../pi-embedded-CM97XTkp.js";
import "../../image-ops-Db3kwMRr.js";
import "../../boolean-Bb19hm9Y.js";
import "../../model-auth-Bos4xjOH.js";
import "../../config-Dr8z937s.js";
import "../../send-B9hfQuuv.js";
import "../../send-DqFR2tga.js";
import "../../send-BA6n3AqM.js";
import "../../github-copilot-token-BXEGgIt5.js";
import "../../pi-model-discovery-Cexg1XRf.js";
import "../../pi-embedded-helpers-CUD7UoUC.js";
import "../../chrome-BaJk80VF.js";
import "../../frontmatter-yyc9d0b4.js";
import "../../store-Bx3kRvoj.js";
import "../../paths-Ck4L046D.js";
import "../../tool-images-BomM11M6.js";
import "../../image-Drpoo6S0.js";
import "../../manager-NQW5XhE3.js";
import "../../sqlite-C54NeA1C.js";
import "../../retry-BRz5KYcW.js";
import "../../redact-DcuzVizL.js";
import "../../common-Cea6Ar7H.js";
import "../../ir-CGoC6GyL.js";
import "../../fetch-DNxVU_z5.js";
import "../../render-CiikiGbn.js";
import "../../runner-CfRx2Ecl.js";
import "../../send-CURnSuQc.js";
import "../../send-h0_uAQzq.js";
import "../../channel-activity-BOEKbbU8.js";
import "../../tables-DNz0QRDt.js";
import { generateSlugViaLLM } from "../../llm-slug-generator.js";
import { t as resolveHookConfig } from "../../config-Lwt_lr2c.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

//#region src/hooks/bundled/session-memory/handler.ts
/**
* Session memory hook handler
*
* Saves session context to memory when /new command is triggered
* Creates a new dated memory file with LLM-generated slug
*/
const log = createSubsystemLogger("hooks/session-memory");
/**
* Read recent messages from session file for slug generation
*/
async function getRecentSessionContent(sessionFilePath, messageCount = 15) {
	try {
		const lines = (await fs.readFile(sessionFilePath, "utf-8")).trim().split("\n");
		const allMessages = [];
		for (const line of lines) try {
			const entry = JSON.parse(line);
			if (entry.type === "message" && entry.message) {
				const msg = entry.message;
				const role = msg.role;
				if ((role === "user" || role === "assistant") && msg.content) {
					if (role === "user" && hasInterSessionUserProvenance(msg)) continue;
					const text = Array.isArray(msg.content) ? msg.content.find((c) => c.type === "text")?.text : msg.content;
					if (text && !text.startsWith("/")) allMessages.push(`${role}: ${text}`);
				}
			}
		} catch {}
		return allMessages.slice(-messageCount).join("\n");
	} catch {
		return null;
	}
}
/**
* Save session context to memory when /new command is triggered
*/
const saveSessionToMemory = async (event) => {
	if (event.type !== "command" || event.action !== "new") return;
	try {
		log.debug("Hook triggered for /new command");
		const context = event.context || {};
		const cfg = context.cfg;
		const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
		const workspaceDir = cfg ? resolveAgentWorkspaceDir(cfg, agentId) : path.join(resolveStateDir(process.env, os.homedir), "workspace");
		const memoryDir = path.join(workspaceDir, "memory");
		await fs.mkdir(memoryDir, { recursive: true });
		const now = new Date(event.timestamp);
		const dateStr = now.toISOString().split("T")[0];
		const sessionEntry = context.previousSessionEntry || context.sessionEntry || {};
		const currentSessionId = sessionEntry.sessionId;
		const currentSessionFile = sessionEntry.sessionFile;
		log.debug("Session context resolved", {
			sessionId: currentSessionId,
			sessionFile: currentSessionFile,
			hasCfg: Boolean(cfg)
		});
		const sessionFile = currentSessionFile || void 0;
		const hookConfig = resolveHookConfig(cfg, "session-memory");
		const messageCount = typeof hookConfig?.messages === "number" && hookConfig.messages > 0 ? hookConfig.messages : 15;
		let slug = null;
		let sessionContent = null;
		if (sessionFile) {
			sessionContent = await getRecentSessionContent(sessionFile, messageCount);
			log.debug("Session content loaded", {
				length: sessionContent?.length ?? 0,
				messageCount
			});
			const allowLlmSlug = !(process.env.OPENCLAW_TEST_FAST === "1" || process.env.VITEST === "true" || process.env.VITEST === "1" || false) && hookConfig?.llmSlug !== false;
			if (sessionContent && cfg && allowLlmSlug) {
				log.debug("Calling generateSlugViaLLM...");
				slug = await generateSlugViaLLM({
					sessionContent,
					cfg
				});
				log.debug("Generated slug", { slug });
			}
		}
		if (!slug) {
			slug = now.toISOString().split("T")[1].split(".")[0].replace(/:/g, "").slice(0, 4);
			log.debug("Using fallback timestamp slug", { slug });
		}
		const filename = `${dateStr}-${slug}.md`;
		const memoryFilePath = path.join(memoryDir, filename);
		log.debug("Memory file path resolved", {
			filename,
			path: memoryFilePath.replace(os.homedir(), "~")
		});
		const timeStr = now.toISOString().split("T")[1].split(".")[0];
		const sessionId = sessionEntry.sessionId || "unknown";
		const source = context.commandSource || "unknown";
		const entryParts = [
			`# Session: ${dateStr} ${timeStr} UTC`,
			"",
			`- **Session Key**: ${event.sessionKey}`,
			`- **Session ID**: ${sessionId}`,
			`- **Source**: ${source}`,
			""
		];
		if (sessionContent) entryParts.push("## Conversation Summary", "", sessionContent, "");
		const entry = entryParts.join("\n");
		await fs.writeFile(memoryFilePath, entry, "utf-8");
		log.debug("Memory file written successfully");
		const relPath = memoryFilePath.replace(os.homedir(), "~");
		log.info(`Session context saved to ${relPath}`);
	} catch (err) {
		if (err instanceof Error) log.error("Failed to save session memory", {
			errorName: err.name,
			errorMessage: err.message,
			stack: err.stack
		});
		else log.error("Failed to save session memory", { error: String(err) });
	}
};

//#endregion
export { saveSessionToMemory as default };