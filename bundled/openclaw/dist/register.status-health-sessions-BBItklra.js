import { D as setVerbose, N as theme, g as defaultRuntime } from "./entry.js";
import "./auth-profiles-BWqNRMgG.js";
import "./utils-DZM-aXiE.js";
import "./exec-aioTkwpP.js";
import "./agent-scope-D-q7eKVm.js";
import "./github-copilot-token-Cqx9_dJi.js";
import "./pi-model-discovery-EhM2JAQo.js";
import "./skills-_fFRgbPu.js";
import "./manifest-registry-By5_tzJo.js";
import "./skills-status-qI8rBmks.js";
import "./config-Dhccn237.js";
import "./plugins-BnuyZ2Wy.js";
import "./logging-6s9Eiv1e.js";
import "./accounts-ATQywTNB.js";
import "./send-dCoRHQjc.js";
import "./send-BrjKyPg_.js";
import "./reply-CrwRmeCr.js";
import "./media-jAjl2iil.js";
import "./message-channel-BecDlYW9.js";
import "./render-CC3QzhUn.js";
import "./tables-GrlK2j3a.js";
import "./image-ops-DIfvMtad.js";
import "./fetch-D5DTbD03.js";
import "./tool-images-BQAYNcA_.js";
import "./common-flt09mDR.js";
import "./server-context-s3xWq7m3.js";
import "./chrome-BRBns8fW.js";
import "./auth-CjzSe-Vc.js";
import "./ports-B01ecUzU.js";
import "./trash-BwRE37gV.js";
import "./control-service-Cj_cxFqX.js";
import "./deliver-DPvh-5xr.js";
import "./pi-embedded-helpers-1VoyogxV.js";
import "./sessions-BK1H0ugi.js";
import "./runner-DoVotVW7.js";
import "./image-CL8yvEzz.js";
import "./models-config-D1QzxgMY.js";
import "./sandbox-CWeyov8H.js";
import "./routes-CaSRevJn.js";
import "./paths-jbTa_y3m.js";
import "./store-Cn-gqoH5.js";
import "./paths-DiTZA01b.js";
import "./redact-1PNP01B_.js";
import "./tool-display-C2p-iSlz.js";
import "./context-D5JPpgxa.js";
import "./with-timeout-CXT6WujF.js";
import "./send-DxMz0f-R.js";
import "./memory-cli-B0IaK2Lq.js";
import "./manager-BkjmfXHe.js";
import "./sqlite-DV-Oz6PD.js";
import "./retry-NBwLy5r3.js";
import "./commands-registry-CVOvB-TT.js";
import "./client-Csp-2oRh.js";
import "./call-B9XcIpQ-.js";
import "./channel-activity-zsOWc2wE.js";
import "./send-C-4nlSyZ.js";
import { t as formatDocsLink } from "./links-CsVmLlFn.js";
import { n as runCommandWithRuntime } from "./cli-utils-C4wXq5N-.js";
import "./progress-CPwotF7H.js";
import "./pairing-store-6LVzE5wS.js";
import "./pi-tools.policy-uECcvl-X.js";
import "./send-BE-dasjw.js";
import "./onboard-helpers-l1NHeo7i.js";
import "./prompt-style-B6Z4pIdl.js";
import "./pairing-labels-B_V5KBBy.js";
import "./session-cost-usage-DH0dSeVa.js";
import "./nodes-screen-Bnn6YgFt.js";
import "./channel-selection-B7kU_hWM.js";
import "./delivery-queue-BTOx9sLI.js";
import "./dangerous-tools-17gkagHW.js";
import { t as formatHelpExamples } from "./help-format-BhTfpcfy.js";
import "./skill-scanner-CMhIBM0S.js";
import "./channels-status-issues-Dl2yGMxQ.js";
import { n as parsePositiveIntOrUndefined } from "./helpers-CgAOTnxe.js";
import "./service-7hnvi87Y.js";
import "./systemd-BP_hPj6J.js";
import "./diagnostics-B895Za_F.js";
import "./table-CoQdktrn.js";
import "./audit-DZ_2v6TF.js";
import { r as healthCommand } from "./health-MCmtGT7n.js";
import "./update-check-PJMwKkdU.js";
import { n as statusCommand } from "./status-DOynQCsk.js";
import "./node-service-RvjhtsGc.js";
import "./status.update-CNF5fdC4.js";
import { sessionsCommand } from "./sessions-Dh2b1DOy.js";

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