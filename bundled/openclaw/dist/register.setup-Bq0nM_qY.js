import { N as theme, g as defaultRuntime } from "./entry.js";
import "./auth-profiles-BWqNRMgG.js";
import { S as shortenHomePath } from "./utils-DZM-aXiE.js";
import "./exec-aioTkwpP.js";
import { f as DEFAULT_AGENT_WORKSPACE_DIR, x as ensureAgentWorkspace } from "./agent-scope-D-q7eKVm.js";
import "./github-copilot-token-Cqx9_dJi.js";
import "./pi-model-discovery-EhM2JAQo.js";
import "./skills-_fFRgbPu.js";
import "./manifest-registry-By5_tzJo.js";
import "./skills-status-qI8rBmks.js";
import { l as writeConfigFile, r as createConfigIO } from "./config-Dhccn237.js";
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
import { o as resolveSessionTranscriptsDir } from "./paths-DiTZA01b.js";
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
import "./catalog-6NJF6ATM.js";
import "./note-BmK3mDX7.js";
import "./clack-prompter-BYPA1n8c.js";
import "./plugin-auto-enable-M0ElsYts.js";
import "./onboard-channels-s4nDstGF.js";
import "./npm-registry-spec-DRS5Jmro.js";
import "./skill-scanner-CMhIBM0S.js";
import "./installs-DFzHOAlW.js";
import { t as hasExplicitOptions } from "./command-options-CSbuuqHr.js";
import "./register.subclis-pUGBAqMo.js";
import "./command-registry-BwbTINHh.js";
import "./program-context-BPp9Yja6.js";
import "./completion-cli-CVO9ZA7Q.js";
import "./daemon-runtime-DjNAwwST.js";
import "./service-7hnvi87Y.js";
import "./systemd-BP_hPj6J.js";
import "./widearea-dns-DGKP2o1l.js";
import "./onboard-skills-Sz8-LdAo.js";
import "./health-MCmtGT7n.js";
import "./health-format-BemPCTHE.js";
import "./auth-choice-Cai1xZb-.js";
import "./github-copilot-auth-BeXkhisw.js";
import { n as logConfigUpdated, t as formatConfigPath } from "./logging-CL5j2Kfg.js";
import "./hooks-status--ISL0Ry_.js";
import "./onboarding-CGiqRyK4.js";
import "./tui-GvuAqDW0.js";
import "./doctor-completion-D371BUQA.js";
import "./systemd-linger-CfNmUMbG.js";
import { t as onboardCommand } from "./onboard-Bg5swTUm.js";
import JSON5 from "json5";
import fs from "node:fs/promises";

//#region src/commands/setup.ts
async function readConfigFileRaw(configPath) {
	try {
		const raw = await fs.readFile(configPath, "utf-8");
		const parsed = JSON5.parse(raw);
		if (parsed && typeof parsed === "object") return {
			exists: true,
			parsed
		};
		return {
			exists: true,
			parsed: {}
		};
	} catch {
		return {
			exists: false,
			parsed: {}
		};
	}
}
async function setupCommand(opts, runtime = defaultRuntime) {
	const desiredWorkspace = typeof opts?.workspace === "string" && opts.workspace.trim() ? opts.workspace.trim() : void 0;
	const configPath = createConfigIO().configPath;
	const existingRaw = await readConfigFileRaw(configPath);
	const cfg = existingRaw.parsed;
	const defaults = cfg.agents?.defaults ?? {};
	const workspace = desiredWorkspace ?? defaults.workspace ?? DEFAULT_AGENT_WORKSPACE_DIR;
	const next = {
		...cfg,
		agents: {
			...cfg.agents,
			defaults: {
				...defaults,
				workspace
			}
		}
	};
	if (!existingRaw.exists || defaults.workspace !== workspace) {
		await writeConfigFile(next);
		if (!existingRaw.exists) runtime.log(`Wrote ${formatConfigPath(configPath)}`);
		else logConfigUpdated(runtime, {
			path: configPath,
			suffix: "(set agents.defaults.workspace)"
		});
	} else runtime.log(`Config OK: ${formatConfigPath(configPath)}`);
	const ws = await ensureAgentWorkspace({
		dir: workspace,
		ensureBootstrapFiles: !next.agents?.defaults?.skipBootstrap
	});
	runtime.log(`Workspace OK: ${shortenHomePath(ws.dir)}`);
	const sessionsDir = resolveSessionTranscriptsDir();
	await fs.mkdir(sessionsDir, { recursive: true });
	runtime.log(`Sessions OK: ${shortenHomePath(sessionsDir)}`);
}

//#endregion
//#region src/cli/program/register.setup.ts
function registerSetupCommand(program) {
	program.command("setup").description("Initialize ~/.openclaw/openclaw.json and the agent workspace").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/setup", "docs.openclaw.ai/cli/setup")}\n`).option("--workspace <dir>", "Agent workspace directory (default: ~/.openclaw/workspace; stored as agents.defaults.workspace)").option("--wizard", "Run the interactive onboarding wizard", false).option("--non-interactive", "Run the wizard without prompts", false).option("--mode <mode>", "Wizard mode: local|remote").option("--remote-url <url>", "Remote Gateway WebSocket URL").option("--remote-token <token>", "Remote Gateway token (optional)").action(async (opts, command) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			const hasWizardFlags = hasExplicitOptions(command, [
				"wizard",
				"nonInteractive",
				"mode",
				"remoteUrl",
				"remoteToken"
			]);
			if (opts.wizard || hasWizardFlags) {
				await onboardCommand({
					workspace: opts.workspace,
					nonInteractive: Boolean(opts.nonInteractive),
					mode: opts.mode,
					remoteUrl: opts.remoteUrl,
					remoteToken: opts.remoteToken
				}, defaultRuntime);
				return;
			}
			await setupCommand({ workspace: opts.workspace }, defaultRuntime);
		});
	});
}

//#endregion
export { registerSetupCommand };