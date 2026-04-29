import "./paths-B4BZAPZh.js";
import { A as info, B as isRich, F as setVerbose, V as theme, d as defaultRuntime } from "./subsystem-BbhgPUzd.js";
import "./utils-Bu8JlY-C.js";
import "./pi-embedded-helpers-DLeTj87G.js";
import { Ar as lookupContextTokens } from "./reply-CYMZTXlH.js";
import "./exec-DrOTyHk4.js";
import "./agent-scope-dwzDG1b1.js";
import { Ft as DEFAULT_CONTEXT_TOKENS, It as DEFAULT_MODEL, Lt as DEFAULT_PROVIDER, d as resolveConfiguredModelRef } from "./model-selection-ChgnVmWu.js";
import "./github-copilot-token-nncItI8D.js";
import "./boolean-BgXe2hyu.js";
import "./env-Cw8GAYpM.js";
import { i as loadConfig } from "./config-DTbrEHqs.js";
import "./manifest-registry-DoWer6SS.js";
import "./plugins-o2q9tVRq.js";
import { O as resolveFreshSessionTotalTokens, i as loadSessionStore } from "./sessions-BsVHT42i.js";
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
import { c as resolveStorePath } from "./paths-DyUlTxmU.js";
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
import { n as formatTimeAgo } from "./format-relative-C6kUHuOj.js";
import "./channel-activity-BokC07Jf.js";
import "./tables-cdhSq17V.js";
import "./send-zpmwLOS9.js";
import { t as formatDocsLink } from "./links-RE4B0nzB.js";
import { n as runCommandWithRuntime } from "./cli-utils-DKF-leO3.js";
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
import { n as parsePositiveIntOrUndefined } from "./helpers-BqTA4Sku.js";
import "./skills-status-CZbSlnxZ.js";
import "./dangerous-tools-17GpE8Yz.js";
import { t as formatHelpExamples } from "./help-format-R2etHxrm.js";
import "./skill-scanner-MgCRxbOf.js";
import "./channels-status-issues-oiFJCwgm.js";
import "./service-BmdpdrKO.js";
import "./systemd-CfWFfqz_.js";
import "./diagnostics-C0LsoJq7.js";
import "./table-BLMSXjAe.js";
import "./audit-D0REnQlQ.js";
import { r as healthCommand } from "./health-v46l7iF9.js";
import "./update-check-BmqZh2fU.js";
import { t as statusCommand } from "./status-DDg1IFyC.js";
import "./node-service-B_KSNg6K.js";
import "./status.update-BRy8t_EY.js";

//#region src/commands/sessions.ts
const KIND_PAD = 6;
const KEY_PAD = 26;
const AGE_PAD = 9;
const MODEL_PAD = 14;
const TOKENS_PAD = 20;
const formatKTokens = (value) => `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}k`;
const truncateKey = (key) => {
	if (key.length <= KEY_PAD) return key;
	const head = Math.max(4, KEY_PAD - 10);
	return `${key.slice(0, head)}...${key.slice(-6)}`;
};
const colorByPct = (label, pct, rich) => {
	if (!rich || pct === null) return label;
	if (pct >= 95) return theme.error(label);
	if (pct >= 80) return theme.warn(label);
	if (pct >= 60) return theme.success(label);
	return theme.muted(label);
};
const formatTokensCell = (total, contextTokens, rich) => {
	if (total === void 0) {
		const label = `unknown/${contextTokens ? formatKTokens(contextTokens) : "?"} (?%)`;
		return rich ? theme.muted(label.padEnd(TOKENS_PAD)) : label.padEnd(TOKENS_PAD);
	}
	const totalLabel = formatKTokens(total);
	const ctxLabel = contextTokens ? formatKTokens(contextTokens) : "?";
	const pct = contextTokens ? Math.min(999, Math.round(total / contextTokens * 100)) : null;
	return colorByPct(`${totalLabel}/${ctxLabel} (${pct ?? "?"}%)`.padEnd(TOKENS_PAD), pct, rich);
};
const formatKindCell = (kind, rich) => {
	const label = kind.padEnd(KIND_PAD);
	if (!rich) return label;
	if (kind === "group") return theme.accentBright(label);
	if (kind === "global") return theme.warn(label);
	if (kind === "direct") return theme.accent(label);
	return theme.muted(label);
};
const formatAgeCell = (updatedAt, rich) => {
	const padded = (updatedAt ? formatTimeAgo(Date.now() - updatedAt) : "unknown").padEnd(AGE_PAD);
	return rich ? theme.muted(padded) : padded;
};
const formatModelCell = (model, rich) => {
	const label = (model ?? "unknown").padEnd(MODEL_PAD);
	return rich ? theme.info(label) : label;
};
const formatFlagsCell = (row, rich) => {
	const label = [
		row.thinkingLevel ? `think:${row.thinkingLevel}` : null,
		row.verboseLevel ? `verbose:${row.verboseLevel}` : null,
		row.reasoningLevel ? `reasoning:${row.reasoningLevel}` : null,
		row.elevatedLevel ? `elev:${row.elevatedLevel}` : null,
		row.responseUsage ? `usage:${row.responseUsage}` : null,
		row.groupActivation ? `activation:${row.groupActivation}` : null,
		row.systemSent ? "system" : null,
		row.abortedLastRun ? "aborted" : null,
		row.sessionId ? `id:${row.sessionId}` : null
	].filter(Boolean).join(" ");
	return label.length === 0 ? "" : rich ? theme.muted(label) : label;
};
function classifyKey(key, entry) {
	if (key === "global") return "global";
	if (key === "unknown") return "unknown";
	if (entry?.chatType === "group" || entry?.chatType === "channel") return "group";
	if (key.includes(":group:") || key.includes(":channel:")) return "group";
	return "direct";
}
function toRows(store) {
	return Object.entries(store).map(([key, entry]) => {
		const updatedAt = entry?.updatedAt ?? null;
		return {
			key,
			kind: classifyKey(key, entry),
			updatedAt,
			ageMs: updatedAt ? Date.now() - updatedAt : null,
			sessionId: entry?.sessionId,
			systemSent: entry?.systemSent,
			abortedLastRun: entry?.abortedLastRun,
			thinkingLevel: entry?.thinkingLevel,
			verboseLevel: entry?.verboseLevel,
			reasoningLevel: entry?.reasoningLevel,
			elevatedLevel: entry?.elevatedLevel,
			responseUsage: entry?.responseUsage,
			groupActivation: entry?.groupActivation,
			inputTokens: entry?.inputTokens,
			outputTokens: entry?.outputTokens,
			totalTokens: entry?.totalTokens,
			totalTokensFresh: entry?.totalTokensFresh,
			model: entry?.model,
			contextTokens: entry?.contextTokens
		};
	}).toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
async function sessionsCommand(opts, runtime) {
	const cfg = loadConfig();
	const resolved = resolveConfiguredModelRef({
		cfg,
		defaultProvider: DEFAULT_PROVIDER,
		defaultModel: DEFAULT_MODEL
	});
	const configContextTokens = cfg.agents?.defaults?.contextTokens ?? lookupContextTokens(resolved.model) ?? DEFAULT_CONTEXT_TOKENS;
	const configModel = resolved.model ?? DEFAULT_MODEL;
	const storePath = resolveStorePath(opts.store ?? cfg.session?.store);
	const store = loadSessionStore(storePath);
	let activeMinutes;
	if (opts.active !== void 0) {
		const parsed = Number.parseInt(String(opts.active), 10);
		if (Number.isNaN(parsed) || parsed <= 0) {
			runtime.error("--active must be a positive integer (minutes)");
			runtime.exit(1);
			return;
		}
		activeMinutes = parsed;
	}
	const rows = toRows(store).filter((row) => {
		if (activeMinutes === void 0) return true;
		if (!row.updatedAt) return false;
		return Date.now() - row.updatedAt <= activeMinutes * 6e4;
	});
	if (opts.json) {
		runtime.log(JSON.stringify({
			path: storePath,
			count: rows.length,
			activeMinutes: activeMinutes ?? null,
			sessions: rows.map((r) => ({
				...r,
				totalTokens: resolveFreshSessionTotalTokens(r) ?? null,
				totalTokensFresh: typeof r.totalTokens === "number" ? r.totalTokensFresh !== false : false,
				contextTokens: r.contextTokens ?? lookupContextTokens(r.model) ?? configContextTokens ?? null,
				model: r.model ?? configModel ?? null
			}))
		}, null, 2));
		return;
	}
	runtime.log(info(`Session store: ${storePath}`));
	runtime.log(info(`Sessions listed: ${rows.length}`));
	if (activeMinutes) runtime.log(info(`Filtered to last ${activeMinutes} minute(s)`));
	if (rows.length === 0) {
		runtime.log("No sessions found.");
		return;
	}
	const rich = isRich();
	const header = [
		"Kind".padEnd(KIND_PAD),
		"Key".padEnd(KEY_PAD),
		"Age".padEnd(AGE_PAD),
		"Model".padEnd(MODEL_PAD),
		"Tokens (ctx %)".padEnd(TOKENS_PAD),
		"Flags"
	].join(" ");
	runtime.log(rich ? theme.heading(header) : header);
	for (const row of rows) {
		const model = row.model ?? configModel;
		const contextTokens = row.contextTokens ?? lookupContextTokens(model) ?? configContextTokens;
		const total = resolveFreshSessionTotalTokens(row);
		const keyLabel = truncateKey(row.key).padEnd(KEY_PAD);
		const keyCell = rich ? theme.accent(keyLabel) : keyLabel;
		const line = [
			formatKindCell(row.kind, rich),
			keyCell,
			formatAgeCell(row.updatedAt, rich),
			formatModelCell(model, rich),
			formatTokensCell(total, contextTokens ?? null, rich),
			formatFlagsCell(row, rich)
		].join(" ");
		runtime.log(line.trimEnd());
	}
}

//#endregion
//#region src/cli/program/register.status-health-sessions.ts
function resolveVerbose(opts) {
	return Boolean(opts.verbose || opts.debug);
}
function parseTimeoutMs(timeout) {
	const parsed = parsePositiveIntOrUndefined(timeout);
	if (timeout !== void 0 && parsed === void 0) {
		defaultRuntime.error("--timeout must be a positive integer (milliseconds)");
		defaultRuntime.exit(1);
		return null;
	}
	return parsed;
}
function registerStatusHealthSessionsCommands(program) {
	program.command("status").description("Show channel health and recent session recipients").option("--json", "Output JSON instead of text", false).option("--all", "Full diagnosis (read-only, pasteable)", false).option("--usage", "Show model provider usage/quota snapshots", false).option("--deep", "Probe channels (WhatsApp Web + Telegram + Discord + Slack + Signal)", false).option("--timeout <ms>", "Probe timeout in milliseconds", "10000").option("--verbose", "Verbose logging", false).option("--debug", "Alias for --verbose", false).addHelpText("after", () => `\n${theme.heading("Examples:")}\n${formatHelpExamples([
		["openclaw status", "Show channel health + session summary."],
		["openclaw status --all", "Full diagnosis (read-only)."],
		["openclaw status --json", "Machine-readable output."],
		["openclaw status --usage", "Show model provider usage/quota snapshots."],
		["openclaw status --deep", "Run channel probes (WA + Telegram + Discord + Slack + Signal)."],
		["openclaw status --deep --timeout 5000", "Tighten probe timeout."]
	])}`).addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/status", "docs.openclaw.ai/cli/status")}\n`).action(async (opts) => {
		const verbose = resolveVerbose(opts);
		setVerbose(verbose);
		const timeout = parseTimeoutMs(opts.timeout);
		if (timeout === null) return;
		await runCommandWithRuntime(defaultRuntime, async () => {
			await statusCommand({
				json: Boolean(opts.json),
				all: Boolean(opts.all),
				deep: Boolean(opts.deep),
				usage: Boolean(opts.usage),
				timeoutMs: timeout,
				verbose
			}, defaultRuntime);
		});
	});
	program.command("health").description("Fetch health from the running gateway").option("--json", "Output JSON instead of text", false).option("--timeout <ms>", "Connection timeout in milliseconds", "10000").option("--verbose", "Verbose logging", false).option("--debug", "Alias for --verbose", false).addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/health", "docs.openclaw.ai/cli/health")}\n`).action(async (opts) => {
		const verbose = resolveVerbose(opts);
		setVerbose(verbose);
		const timeout = parseTimeoutMs(opts.timeout);
		if (timeout === null) return;
		await runCommandWithRuntime(defaultRuntime, async () => {
			await healthCommand({
				json: Boolean(opts.json),
				timeoutMs: timeout,
				verbose
			}, defaultRuntime);
		});
	});
	program.command("sessions").description("List stored conversation sessions").option("--json", "Output as JSON", false).option("--verbose", "Verbose logging", false).option("--store <path>", "Path to session store (default: resolved from config)").option("--active <minutes>", "Only show sessions updated within the past N minutes").addHelpText("after", () => `\n${theme.heading("Examples:")}\n${formatHelpExamples([
		["openclaw sessions", "List all sessions."],
		["openclaw sessions --active 120", "Only last 2 hours."],
		["openclaw sessions --json", "Machine-readable output."],
		["openclaw sessions --store ./tmp/sessions.json", "Use a specific session store."]
	])}\n\n${theme.muted("Shows token usage per session when the agent reports it; set agents.defaults.contextTokens to cap the window and show %.")}`).addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/sessions", "docs.openclaw.ai/cli/sessions")}\n`).action(async (opts) => {
		setVerbose(Boolean(opts.verbose));
		await sessionsCommand({
			json: Boolean(opts.json),
			store: opts.store,
			active: opts.active
		}, defaultRuntime);
	});
}

//#endregion
export { registerStatusHealthSessionsCommands };