import "./paths-B4BZAPZh.js";
import { d as defaultRuntime } from "./subsystem-BbhgPUzd.js";
import "./utils-Bu8JlY-C.js";
import "./pi-embedded-helpers-DLeTj87G.js";
import { E as resolveGatewaySessionStoreTarget, Fr as enqueueSystemEvent, T as pruneLegacyStoreKeys, bt as requestHeartbeatNow, w as loadSessionEntry } from "./reply-CYMZTXlH.js";
import { u as normalizeMainKey } from "./session-key-BWxPj0z_.js";
import "./exec-DrOTyHk4.js";
import "./agent-scope-dwzDG1b1.js";
import "./model-selection-ChgnVmWu.js";
import "./github-copilot-token-nncItI8D.js";
import "./boolean-BgXe2hyu.js";
import "./env-Cw8GAYpM.js";
import { i as loadConfig } from "./config-DTbrEHqs.js";
import "./manifest-registry-DoWer6SS.js";
import { r as normalizeChannelId } from "./plugins-o2q9tVRq.js";
import { l as updateSessionStore } from "./sessions-BsVHT42i.js";
import "./runner-STmMAoZV.js";
import "./image-nTaz5goe.js";
import "./pi-model-discovery-EwKVHlZB.js";
import "./sandbox-DuE0_fOw.js";
import "./chrome-DzwpOpfW.js";
import "./auth-CkNWu3pU.js";
import "./server-context-DldOiQs9.js";
import "./skills-C1b_I-in.js";
import "./routes-BR0CuaB2.js";
import "./paths-Bd-IpjA5.js";
import "./image-ops-CBI2il7g.js";
import "./store-DGrg_bt3.js";
import "./ports-DOIPQoJU.js";
import "./trash-BjJL37cH.js";
import "./message-channel-djjBp_ms.js";
import "./logging-Bgrm4o7g.js";
import "./accounts-CHuAbvtH.js";
import "./send-DkNfL9jf.js";
import "./send-CzWKhsfN.js";
import "./paths-DyUlTxmU.js";
import "./tool-images-Cboir_K4.js";
import "./redact-hL9mXfoM.js";
import "./tool-display-DEhJp2aG.js";
import "./fetch-CM9eyp_0.js";
import "./deliver-N3OqJwZc.js";
import "./with-timeout-B2q8D-hU.js";
import "./send-BZpj7pKG.js";
import "./memory-cli-DFgLAu1P.js";
import "./manager-BtQpCTLW.js";
import "./sqlite-BDAXaB9c.js";
import "./retry-CPS29_oo.js";
import "./common-Rd0t95eh.js";
import "./ir-B5ufFET-.js";
import "./render-flG67HhW.js";
import "./commands-registry-CtrFLx9F.js";
import "./client-B5KEYk4h.js";
import "./call-Kcg_5Iyy.js";
import "./channel-activity-BokC07Jf.js";
import "./tables-cdhSq17V.js";
import "./send-zpmwLOS9.js";
import "./links-RE4B0nzB.js";
import "./progress-7dZAz09F.js";
import "./pairing-store-CpVA0Zrb.js";
import "./pi-tools.policy-IuFI-7be.js";
import "./send-13ZakwFz.js";
import "./onboard-helpers-DsWG_ruh.js";
import "./prompt-style-_k1DA6Wp.js";
import "./pairing-labels-DRgmeoqx.js";
import "./session-cost-usage-r-Rovr3R.js";
import "./nodes-screen-BiNBeuxJ.js";
import "./control-service-duwKSJek.js";
import "./channel-selection-Ct5caPKx.js";
import "./delivery-queue-CJGN_Wrf.js";
import "./deps-DGzocYMK.js";
import { t as formatForLog } from "./ws-log-Bets3CvZ.js";
import { t as agentCommand } from "./agent-DMu-ucrG.js";
import { randomUUID } from "node:crypto";

//#region src/gateway/server-node-events.ts
const MAX_EXEC_EVENT_OUTPUT_CHARS = 180;
function compactExecEventOutput(raw) {
	const normalized = raw.replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	if (normalized.length <= MAX_EXEC_EVENT_OUTPUT_CHARS) return normalized;
	const safe = Math.max(1, MAX_EXEC_EVENT_OUTPUT_CHARS - 1);
	return `${normalized.slice(0, safe)}…`;
}
async function touchSessionStore(params) {
	const { storePath } = params;
	if (!storePath) return;
	await updateSessionStore(storePath, (store) => {
		const target = resolveGatewaySessionStoreTarget({
			cfg: params.cfg,
			key: params.sessionKey,
			store
		});
		pruneLegacyStoreKeys({
			store,
			canonicalKey: target.canonicalKey,
			candidates: target.storeKeys
		});
		store[params.canonicalKey] = {
			sessionId: params.sessionId,
			updatedAt: params.now,
			thinkingLevel: params.entry?.thinkingLevel,
			verboseLevel: params.entry?.verboseLevel,
			reasoningLevel: params.entry?.reasoningLevel,
			systemSent: params.entry?.systemSent,
			sendPolicy: params.entry?.sendPolicy,
			lastChannel: params.entry?.lastChannel,
			lastTo: params.entry?.lastTo
		};
	});
}
const handleNodeEvent = async (ctx, nodeId, evt) => {
	switch (evt.event) {
		case "voice.transcript": {
			if (!evt.payloadJSON) return;
			let payload;
			try {
				payload = JSON.parse(evt.payloadJSON);
			} catch {
				return;
			}
			const obj = typeof payload === "object" && payload !== null ? payload : {};
			const text = typeof obj.text === "string" ? obj.text.trim() : "";
			if (!text) return;
			if (text.length > 2e4) return;
			const sessionKeyRaw = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : "";
			const cfg = loadConfig();
			const rawMainKey = normalizeMainKey(cfg.session?.mainKey);
			const sessionKey = sessionKeyRaw.length > 0 ? sessionKeyRaw : rawMainKey;
			const { storePath, entry, canonicalKey } = loadSessionEntry(sessionKey);
			const now = Date.now();
			const sessionId = entry?.sessionId ?? randomUUID();
			await touchSessionStore({
				cfg,
				sessionKey,
				storePath,
				canonicalKey,
				entry,
				sessionId,
				now
			});
			ctx.addChatRun(sessionId, {
				sessionKey: canonicalKey,
				clientRunId: `voice-${randomUUID()}`
			});
			agentCommand({
				message: text,
				sessionId,
				sessionKey: canonicalKey,
				thinking: "low",
				deliver: false,
				messageChannel: "node"
			}, defaultRuntime, ctx.deps).catch((err) => {
				ctx.logGateway.warn(`agent failed node=${nodeId}: ${formatForLog(err)}`);
			});
			return;
		}
		case "agent.request": {
			if (!evt.payloadJSON) return;
			let link = null;
			try {
				link = JSON.parse(evt.payloadJSON);
			} catch {
				return;
			}
			const message = (link?.message ?? "").trim();
			if (!message) return;
			if (message.length > 2e4) return;
			const channel = normalizeChannelId(typeof link?.channel === "string" ? link.channel.trim() : "") ?? void 0;
			const to = typeof link?.to === "string" && link.to.trim() ? link.to.trim() : void 0;
			const deliver = Boolean(link?.deliver) && Boolean(channel);
			const sessionKeyRaw = (link?.sessionKey ?? "").trim();
			const sessionKey = sessionKeyRaw.length > 0 ? sessionKeyRaw : `node-${nodeId}`;
			const cfg = loadConfig();
			const { storePath, entry, canonicalKey } = loadSessionEntry(sessionKey);
			const now = Date.now();
			const sessionId = entry?.sessionId ?? randomUUID();
			await touchSessionStore({
				cfg,
				sessionKey,
				storePath,
				canonicalKey,
				entry,
				sessionId,
				now
			});
			agentCommand({
				message,
				sessionId,
				sessionKey: canonicalKey,
				thinking: link?.thinking ?? void 0,
				deliver,
				to,
				channel,
				timeout: typeof link?.timeoutSeconds === "number" ? link.timeoutSeconds.toString() : void 0,
				messageChannel: "node"
			}, defaultRuntime, ctx.deps).catch((err) => {
				ctx.logGateway.warn(`agent failed node=${nodeId}: ${formatForLog(err)}`);
			});
			return;
		}
		case "chat.subscribe": {
			if (!evt.payloadJSON) return;
			let payload;
			try {
				payload = JSON.parse(evt.payloadJSON);
			} catch {
				return;
			}
			const obj = typeof payload === "object" && payload !== null ? payload : {};
			const sessionKey = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : "";
			if (!sessionKey) return;
			ctx.nodeSubscribe(nodeId, sessionKey);
			return;
		}
		case "chat.unsubscribe": {
			if (!evt.payloadJSON) return;
			let payload;
			try {
				payload = JSON.parse(evt.payloadJSON);
			} catch {
				return;
			}
			const obj = typeof payload === "object" && payload !== null ? payload : {};
			const sessionKey = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : "";
			if (!sessionKey) return;
			ctx.nodeUnsubscribe(nodeId, sessionKey);
			return;
		}
		case "exec.started":
		case "exec.finished":
		case "exec.denied": {
			if (!evt.payloadJSON) return;
			let payload;
			try {
				payload = JSON.parse(evt.payloadJSON);
			} catch {
				return;
			}
			const obj = typeof payload === "object" && payload !== null ? payload : {};
			const sessionKey = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : `node-${nodeId}`;
			if (!sessionKey) return;
			const runId = typeof obj.runId === "string" ? obj.runId.trim() : "";
			const command = typeof obj.command === "string" ? obj.command.trim() : "";
			const exitCode = typeof obj.exitCode === "number" && Number.isFinite(obj.exitCode) ? obj.exitCode : void 0;
			const timedOut = obj.timedOut === true;
			const output = typeof obj.output === "string" ? obj.output.trim() : "";
			const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
			let text = "";
			if (evt.event === "exec.started") {
				text = `Exec started (node=${nodeId}${runId ? ` id=${runId}` : ""})`;
				if (command) text += `: ${command}`;
			} else if (evt.event === "exec.finished") {
				const exitLabel = timedOut ? "timeout" : `code ${exitCode ?? "?"}`;
				const compactOutput = compactExecEventOutput(output);
				if (!(timedOut || exitCode !== 0 || compactOutput.length > 0)) return;
				text = `Exec finished (node=${nodeId}${runId ? ` id=${runId}` : ""}, ${exitLabel})`;
				if (compactOutput) text += `\n${compactOutput}`;
			} else {
				text = `Exec denied (node=${nodeId}${runId ? ` id=${runId}` : ""}${reason ? `, ${reason}` : ""})`;
				if (command) text += `: ${command}`;
			}
			enqueueSystemEvent(text, {
				sessionKey,
				contextKey: runId ? `exec:${runId}` : "exec"
			});
			requestHeartbeatNow({ reason: "exec-event" });
			return;
		}
		default: return;
	}
};

//#endregion
export { handleNodeEvent };