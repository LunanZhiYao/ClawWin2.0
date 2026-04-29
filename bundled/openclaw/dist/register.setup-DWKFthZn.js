import "./paths-B4BZAPZh.js";
import { V as theme, d as defaultRuntime } from "./subsystem-BbhgPUzd.js";
import { C as shortenHomePath } from "./utils-Bu8JlY-C.js";
import "./pi-embedded-helpers-DLeTj87G.js";
import "./reply-CYMZTXlH.js";
import "./exec-DrOTyHk4.js";
import { f as DEFAULT_AGENT_WORKSPACE_DIR, x as ensureAgentWorkspace } from "./agent-scope-dwzDG1b1.js";
import "./model-selection-ChgnVmWu.js";
import "./github-copilot-token-nncItI8D.js";
import "./boolean-BgXe2hyu.js";
import "./env-Cw8GAYpM.js";
import { l as writeConfigFile, r as createConfigIO } from "./config-DTbrEHqs.js";
import "./manifest-registry-DoWer6SS.js";
import "./plugins-o2q9tVRq.js";
import "./sessions-BsVHT42i.js";
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
import { o as resolveSessionTranscriptsDir } from "./paths-DyUlTxmU.js";
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
import "./program-context-BvTP81tH.js";
import "./catalog-KgzGgAlY.js";
import "./skills-status-CZbSlnxZ.js";
import "./note-D6P6WGO6.js";
import "./clack-prompter-CDRNEIEq.js";
import "./plugin-auto-enable-C3SNAQsT.js";
import "./onboard-channels-DqtbGncN.js";
import "./npm-registry-spec-CguX2-wR.js";
import "./skill-scanner-MgCRxbOf.js";
import "./installs-cu_vs3GK.js";
import { t as hasExplicitOptions } from "./command-options-Da_NMFsN.js";
import "./completion-cli-9OFp3BIb.js";
import "./daemon-runtime-BypEai8I.js";
import "./service-BmdpdrKO.js";
import "./systemd-CfWFfqz_.js";
import "./widearea-dns-_z0-cE6J.js";
import "./onboard-skills-EO5vGuAg.js";
import "./health-v46l7iF9.js";
import "./health-format-Kwo85CEL.js";
import "./auth-choice-B9qgRdsf.js";
import "./github-copilot-auth-BiaSo_ZY.js";
import { n as logConfigUpdated, t as formatConfigPath } from "./logging-DgGsK4TF.js";
import "./hooks-status-BAZV_hb_.js";
import "./onboarding-DmzWwzdf.js";
import "./tui-DMcWwYZ_.js";
import "./doctor-completion-EnSbbc2I.js";
import "./systemd-linger-Cv43CYua.js";
import { t as onboardCommand } from "./onboard-Dqm-G43w.js";
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