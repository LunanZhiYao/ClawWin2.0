import { D as setVerbose, N as theme, g as defaultRuntime, it as DEFAULT_CHAT_CHANNEL } from "./entry.js";
import "./auth-profiles-BWqNRMgG.js";
import { t as formatCliCommand } from "./command-format-BA3gs9CO.js";
import { l as normalizeAgentId } from "./session-key-DVvxnFKg.js";
import "./utils-DZM-aXiE.js";
import "./exec-aioTkwpP.js";
import { t as listAgentIds } from "./agent-scope-D-q7eKVm.js";
import "./github-copilot-token-Cqx9_dJi.js";
import "./pi-model-discovery-EhM2JAQo.js";
import "./skills-_fFRgbPu.js";
import "./manifest-registry-By5_tzJo.js";
import { i as loadConfig } from "./config-Dhccn237.js";
import "./plugins-BnuyZ2Wy.js";
import "./logging-6s9Eiv1e.js";
import "./accounts-ATQywTNB.js";
import "./send-dCoRHQjc.js";
import "./send-BrjKyPg_.js";
import "./reply-CrwRmeCr.js";
import "./media-jAjl2iil.js";
import { h as GATEWAY_CLIENT_NAMES, l as normalizeMessageChannel, m as GATEWAY_CLIENT_MODES } from "./message-channel-BecDlYW9.js";
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
import { i as randomIdempotencyKey, n as callGateway } from "./call-B9XcIpQ-.js";
import "./channel-activity-zsOWc2wE.js";
import "./send-C-4nlSyZ.js";
import { t as formatDocsLink } from "./links-CsVmLlFn.js";
import { n as runCommandWithRuntime } from "./cli-utils-C4wXq5N-.js";
import { n as withProgress } from "./progress-CPwotF7H.js";
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
import { t as formatHelpExamples } from "./help-format-BhTfpcfy.js";
import "./catalog-6NJF6ATM.js";
import "./note-BmK3mDX7.js";
import "./clack-prompter-BYPA1n8c.js";
import "./plugin-auto-enable-M0ElsYts.js";
import "./onboard-channels-s4nDstGF.js";
import "./npm-registry-spec-DRS5Jmro.js";
import "./skill-scanner-CMhIBM0S.js";
import "./installs-DFzHOAlW.js";
import { t as hasExplicitOptions } from "./command-options-CSbuuqHr.js";
import { t as collectOption } from "./helpers-CgAOTnxe.js";
import { n as createDefaultDeps } from "./outbound-send-deps-DOIFQ10i.js";
import "./auth-choice-Cai1xZb-.js";
import "./github-copilot-auth-BeXkhisw.js";
import "./logging-CL5j2Kfg.js";
import "./agents.config-Dv-A8y_C.js";
import { n as resolveSessionKeyForRequest, t as agentCommand } from "./agent-oHs2A4s3.js";
import { agentsAddCommand, agentsDeleteCommand, agentsListCommand, agentsSetIdentityCommand } from "./agents-Dxcu17km.js";

//#region src/commands/agent-via-gateway.ts
function parseTimeoutSeconds(opts) {
	const raw = opts.timeout !== void 0 ? Number.parseInt(String(opts.timeout), 10) : opts.cfg.agents?.defaults?.timeoutSeconds ?? 600;
	if (Number.isNaN(raw) || raw <= 0) throw new Error("--timeout must be a positive integer (seconds)");
	return raw;
}
function formatPayloadForLog(payload) {
	const lines = [];
	if (payload.text) lines.push(payload.text.trimEnd());
	const mediaUrl = typeof payload.mediaUrl === "string" && payload.mediaUrl.trim() ? payload.mediaUrl.trim() : void 0;
	const media = payload.mediaUrls ?? (mediaUrl ? [mediaUrl] : []);
	for (const url of media) lines.push(`MEDIA:${url}`);
	return lines.join("\n").trimEnd();
}
async function agentViaGatewayCommand(opts, runtime) {
	const body = (opts.message ?? "").trim();
	if (!body) throw new Error("Message (--message) is required");
	if (!opts.to && !opts.sessionId && !opts.agent) throw new Error("Pass --to <E.164>, --session-id, or --agent to choose a session");
	const cfg = loadConfig();
	const agentIdRaw = opts.agent?.trim();
	const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : void 0;
	if (agentId) {
		if (!listAgentIds(cfg).includes(agentId)) throw new Error(`Unknown agent id "${agentIdRaw}". Use "${formatCliCommand("openclaw agents list")}" to see configured agents.`);
	}
	const timeoutSeconds = parseTimeoutSeconds({
		cfg,
		timeout: opts.timeout
	});
	const gatewayTimeoutMs = Math.max(1e4, (timeoutSeconds + 30) * 1e3);
	const sessionKey = resolveSessionKeyForRequest({
		cfg,
		agentId,
		to: opts.to,
		sessionId: opts.sessionId
	}).sessionKey;
	const channel = normalizeMessageChannel(opts.channel) ?? DEFAULT_CHAT_CHANNEL;
	const idempotencyKey = opts.runId?.trim() || randomIdempotencyKey();
	const response = await withProgress({
		label: "Waiting for agent reply…",
		indeterminate: true,
		enabled: opts.json !== true
	}, async () => await callGateway({
		method: "agent",
		params: {
			message: body,
			agentId,
			to: opts.to,
			replyTo: opts.replyTo,
			sessionId: opts.sessionId,
			sessionKey,
			thinking: opts.thinking,
			deliver: Boolean(opts.deliver),
			channel,
			replyChannel: opts.replyChannel,
			replyAccountId: opts.replyAccount,
			timeout: timeoutSeconds,
			lane: opts.lane,
			extraSystemPrompt: opts.extraSystemPrompt,
			idempotencyKey
		},
		expectFinal: true,
		timeoutMs: gatewayTimeoutMs,
		clientName: GATEWAY_CLIENT_NAMES.CLI,
		mode: GATEWAY_CLIENT_MODES.CLI
	}));
	if (opts.json) {
		runtime.log(JSON.stringify(response, null, 2));
		return response;
	}
	const payloads = (response?.result)?.payloads ?? [];
	if (payloads.length === 0) {
		runtime.log(response?.summary ? String(response.summary) : "No reply from agent.");
		return response;
	}
	for (const payload of payloads) {
		const out = formatPayloadForLog(payload);
		if (out) runtime.log(out);
	}
	return response;
}
async function agentCliCommand(opts, runtime, deps) {
	const localOpts = {
		...opts,
		agentId: opts.agent,
		replyAccountId: opts.replyAccount
	};
	if (opts.local === true) return await agentCommand(localOpts, runtime, deps);
	try {
		return await agentViaGatewayCommand(opts, runtime);
	} catch (err) {
		runtime.error?.(`Gateway agent failed; falling back to embedded: ${String(err)}`);
		return await agentCommand(localOpts, runtime, deps);
	}
}

//#endregion
//#region src/cli/program/register.agent.ts
function registerAgentCommands(program, args) {
	program.command("agent").description("Run an agent turn via the Gateway (use --local for embedded)").requiredOption("-m, --message <text>", "Message body for the agent").option("-t, --to <number>", "Recipient number in E.164 used to derive the session key").option("--session-id <id>", "Use an explicit session id").option("--agent <id>", "Agent id (overrides routing bindings)").option("--thinking <level>", "Thinking level: off | minimal | low | medium | high").option("--verbose <on|off>", "Persist agent verbose level for the session").option("--channel <channel>", `Delivery channel: ${args.agentChannelOptions} (default: ${DEFAULT_CHAT_CHANNEL})`).option("--reply-to <target>", "Delivery target override (separate from session routing)").option("--reply-channel <channel>", "Delivery channel override (separate from routing)").option("--reply-account <id>", "Delivery account id override").option("--local", "Run the embedded agent locally (requires model provider API keys in your shell)", false).option("--deliver", "Send the agent's reply back to the selected channel", false).option("--json", "Output result as JSON", false).option("--timeout <seconds>", "Override agent command timeout (seconds, default 600 or config value)").addHelpText("after", () => `
${theme.heading("Examples:")}
${formatHelpExamples([
		["openclaw agent --to +15555550123 --message \"status update\"", "Start a new session."],
		["openclaw agent --agent ops --message \"Summarize logs\"", "Use a specific agent."],
		["openclaw agent --session-id 1234 --message \"Summarize inbox\" --thinking medium", "Target a session with explicit thinking level."],
		["openclaw agent --to +15555550123 --message \"Trace logs\" --verbose on --json", "Enable verbose logging and JSON output."],
		["openclaw agent --to +15555550123 --message \"Summon reply\" --deliver", "Deliver reply."],
		["openclaw agent --agent ops --message \"Generate report\" --deliver --reply-channel slack --reply-to \"#reports\"", "Send reply to a different channel/target."]
	])}

${theme.muted("Docs:")} ${formatDocsLink("/cli/agent", "docs.openclaw.ai/cli/agent")}`).action(async (opts) => {
		setVerbose((typeof opts.verbose === "string" ? opts.verbose.toLowerCase() : "") === "on");
		const deps = createDefaultDeps();
		await runCommandWithRuntime(defaultRuntime, async () => {
			await agentCliCommand(opts, defaultRuntime, deps);
		});
	});
	const agents = program.command("agents").description("Manage isolated agents (workspaces + auth + routing)").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/agents", "docs.openclaw.ai/cli/agents")}\n`);
	agents.command("list").description("List configured agents").option("--json", "Output JSON instead of text", false).option("--bindings", "Include routing bindings", false).action(async (opts) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			await agentsListCommand({
				json: Boolean(opts.json),
				bindings: Boolean(opts.bindings)
			}, defaultRuntime);
		});
	});
	agents.command("add [name]").description("Add a new isolated agent").option("--workspace <dir>", "Workspace directory for the new agent").option("--model <id>", "Model id for this agent").option("--agent-dir <dir>", "Agent state directory for this agent").option("--bind <channel[:accountId]>", "Route channel binding (repeatable)", collectOption, []).option("--non-interactive", "Disable prompts; requires --workspace", false).option("--json", "Output JSON summary", false).action(async (name, opts, command) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			const hasFlags = hasExplicitOptions(command, [
				"workspace",
				"model",
				"agentDir",
				"bind",
				"nonInteractive"
			]);
			await agentsAddCommand({
				name: typeof name === "string" ? name : void 0,
				workspace: opts.workspace,
				model: opts.model,
				agentDir: opts.agentDir,
				bind: Array.isArray(opts.bind) ? opts.bind : void 0,
				nonInteractive: Boolean(opts.nonInteractive),
				json: Boolean(opts.json)
			}, defaultRuntime, { hasFlags });
		});
	});
	agents.command("set-identity").description("Update an agent identity (name/theme/emoji/avatar)").option("--agent <id>", "Agent id to update").option("--workspace <dir>", "Workspace directory used to locate the agent + IDENTITY.md").option("--identity-file <path>", "Explicit IDENTITY.md path to read").option("--from-identity", "Read values from IDENTITY.md", false).option("--name <name>", "Identity name").option("--theme <theme>", "Identity theme").option("--emoji <emoji>", "Identity emoji").option("--avatar <value>", "Identity avatar (workspace path, http(s) URL, or data URI)").option("--json", "Output JSON summary", false).addHelpText("after", () => `
${theme.heading("Examples:")}
${formatHelpExamples([
		["openclaw agents set-identity --agent main --name \"OpenClaw\" --emoji \"🦞\"", "Set name + emoji."],
		["openclaw agents set-identity --agent main --avatar avatars/openclaw.png", "Set avatar path."],
		["openclaw agents set-identity --workspace ~/.openclaw/workspace --from-identity", "Load from IDENTITY.md."],
		["openclaw agents set-identity --identity-file ~/.openclaw/workspace/IDENTITY.md --agent main", "Use a specific IDENTITY.md."]
	])}
`).action(async (opts) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			await agentsSetIdentityCommand({
				agent: opts.agent,
				workspace: opts.workspace,
				identityFile: opts.identityFile,
				fromIdentity: Boolean(opts.fromIdentity),
				name: opts.name,
				theme: opts.theme,
				emoji: opts.emoji,
				avatar: opts.avatar,
				json: Boolean(opts.json)
			}, defaultRuntime);
		});
	});
	agents.command("delete <id>").description("Delete an agent and prune workspace/state").option("--force", "Skip confirmation", false).option("--json", "Output JSON summary", false).action(async (id, opts) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			await agentsDeleteCommand({
				id: String(id),
				force: Boolean(opts.force),
				json: Boolean(opts.json)
			}, defaultRuntime);
		});
	});
	agents.action(async () => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			await agentsListCommand({}, defaultRuntime);
		});
	});
}

//#endregion
export { registerAgentCommands };