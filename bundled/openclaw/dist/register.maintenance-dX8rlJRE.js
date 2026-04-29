import { g as resolveStateDir, i as isNixMode, m as resolveOAuthDir, o as resolveConfigPath, u as resolveGatewayPort } from "./paths-B4BZAPZh.js";
import { V as theme, d as defaultRuntime } from "./subsystem-BbhgPUzd.js";
import { S as shortenHomeInString, b as resolveUserPath, v as resolveHomeDir } from "./utils-Bu8JlY-C.js";
import "./pi-embedded-helpers-DLeTj87G.js";
import "./reply-CYMZTXlH.js";
import "./exec-DrOTyHk4.js";
import { w as resolveDefaultAgentWorkspaceDir } from "./agent-scope-dwzDG1b1.js";
import "./model-selection-ChgnVmWu.js";
import "./github-copilot-token-nncItI8D.js";
import { t as formatCliCommand } from "./command-format-ChfKqObn.js";
import "./boolean-BgXe2hyu.js";
import "./env-Cw8GAYpM.js";
import { i as loadConfig, o as readConfigFileSnapshot } from "./config-DTbrEHqs.js";
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
import { t as formatDocsLink } from "./links-RE4B0nzB.js";
import { n as runCommandWithRuntime } from "./cli-utils-DKF-leO3.js";
import "./progress-7dZAz09F.js";
import "./pairing-store-CpVA0Zrb.js";
import "./pi-tools.policy-IuFI-7be.js";
import "./send-13ZakwFz.js";
import { d as openUrl, h as resolveControlUiLinks, i as detectBrowserOpenSupport, o as formatControlUiSshHint } from "./onboard-helpers-DsWG_ruh.js";
import { n as stylePromptMessage, r as stylePromptTitle, t as stylePromptHint } from "./prompt-style-_k1DA6Wp.js";
import "./pairing-labels-DRgmeoqx.js";
import "./session-cost-usage-r-Rovr3R.js";
import "./nodes-screen-BiNBeuxJ.js";
import "./control-service-duwKSJek.js";
import "./channel-selection-Ct5caPKx.js";
import "./delivery-queue-CJGN_Wrf.js";
import "./program-context-BvTP81tH.js";
import "./catalog-KgzGgAlY.js";
import "./skills-status-CZbSlnxZ.js";
import { t as copyToClipboard } from "./clipboard-CT5tpgmA.js";
import "./note-D6P6WGO6.js";
import "./plugin-auto-enable-C3SNAQsT.js";
import "./channels-status-issues-oiFJCwgm.js";
import "./completion-cli-9OFp3BIb.js";
import "./daemon-runtime-BypEai8I.js";
import { t as resolveGatewayService } from "./service-BmdpdrKO.js";
import "./systemd-CfWFfqz_.js";
import "./diagnostics-C0LsoJq7.js";
import "./service-audit-BGxDzmd3.js";
import "./health-v46l7iF9.js";
import "./health-format-Kwo85CEL.js";
import "./update-check-BmqZh2fU.js";
import "./logging-DgGsK4TF.js";
import "./doctor-completion-EnSbbc2I.js";
import "./update-runner-qRF2UdqA.js";
import "./auth-health-DotZ1_9a.js";
import "./doctor-config-flow-BFMvReht.js";
import "./systemd-linger-Cv43CYua.js";
import { t as doctorCommand } from "./doctor-B4g7gPZz.js";
import path from "node:path";
import fs from "node:fs/promises";
import { cancel, confirm, isCancel, multiselect, select } from "@clack/prompts";

//#region src/commands/dashboard.ts
async function dashboardCommand(runtime = defaultRuntime, options = {}) {
	const snapshot = await readConfigFileSnapshot();
	const cfg = snapshot.valid ? snapshot.config : {};
	const port = resolveGatewayPort(cfg);
	const bind = cfg.gateway?.bind ?? "loopback";
	const basePath = cfg.gateway?.controlUi?.basePath;
	const customBindHost = cfg.gateway?.customBindHost;
	const token = cfg.gateway?.auth?.token ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
	const links = resolveControlUiLinks({
		port,
		bind: bind === "lan" ? "loopback" : bind,
		customBindHost,
		basePath
	});
	const dashboardUrl = token ? `${links.httpUrl}#token=${encodeURIComponent(token)}` : links.httpUrl;
	runtime.log(`Dashboard URL: ${dashboardUrl}`);
	const copied = await copyToClipboard(dashboardUrl).catch(() => false);
	runtime.log(copied ? "Copied to clipboard." : "Copy to clipboard unavailable.");
	let opened = false;
	let hint;
	if (!options.noOpen) {
		if ((await detectBrowserOpenSupport()).ok) opened = await openUrl(dashboardUrl);
		if (!opened) hint = formatControlUiSshHint({
			port,
			basePath,
			token: token || void 0
		});
	} else hint = "Browser launch disabled (--no-open). Use the URL above.";
	if (opened) runtime.log("Opened in your browser. Keep that tab to control OpenClaw.");
	else if (hint) runtime.log(hint);
}

//#endregion
//#region src/commands/cleanup-utils.ts
function collectWorkspaceDirs(cfg) {
	const dirs = /* @__PURE__ */ new Set();
	const defaults = cfg?.agents?.defaults;
	if (typeof defaults?.workspace === "string" && defaults.workspace.trim()) dirs.add(resolveUserPath(defaults.workspace));
	const list = Array.isArray(cfg?.agents?.list) ? cfg?.agents?.list : [];
	for (const agent of list) {
		const workspace = agent.workspace;
		if (typeof workspace === "string" && workspace.trim()) dirs.add(resolveUserPath(workspace));
	}
	if (dirs.size === 0) dirs.add(resolveDefaultAgentWorkspaceDir());
	return [...dirs];
}
function isPathWithin(child, parent) {
	const relative = path.relative(parent, child);
	return relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative);
}
function isUnsafeRemovalTarget(target) {
	if (!target.trim()) return true;
	const resolved = path.resolve(target);
	if (resolved === path.parse(resolved).root) return true;
	const home = resolveHomeDir();
	if (home && resolved === path.resolve(home)) return true;
	return false;
}
async function removePath(target, runtime, opts) {
	if (!target?.trim()) return {
		ok: false,
		skipped: true
	};
	const resolved = path.resolve(target);
	const displayLabel = shortenHomeInString(opts?.label ?? resolved);
	if (isUnsafeRemovalTarget(resolved)) {
		runtime.error(`Refusing to remove unsafe path: ${displayLabel}`);
		return { ok: false };
	}
	if (opts?.dryRun) {
		runtime.log(`[dry-run] remove ${displayLabel}`);
		return {
			ok: true,
			skipped: true
		};
	}
	try {
		await fs.rm(resolved, {
			recursive: true,
			force: true
		});
		runtime.log(`Removed ${displayLabel}`);
		return { ok: true };
	} catch (err) {
		runtime.error(`Failed to remove ${displayLabel}: ${String(err)}`);
		return { ok: false };
	}
}
async function listAgentSessionDirs(stateDir) {
	const root = path.join(stateDir, "agents");
	try {
		return (await fs.readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name, "sessions"));
	} catch {
		return [];
	}
}

//#endregion
//#region src/commands/reset.ts
const selectStyled = (params) => select({
	...params,
	message: stylePromptMessage(params.message),
	options: params.options.map((opt) => opt.hint === void 0 ? opt : {
		...opt,
		hint: stylePromptHint(opt.hint)
	})
});
async function stopGatewayIfRunning(runtime) {
	if (isNixMode) return;
	const service = resolveGatewayService();
	let loaded = false;
	try {
		loaded = await service.isLoaded({ env: process.env });
	} catch (err) {
		runtime.error(`Gateway service check failed: ${String(err)}`);
		return;
	}
	if (!loaded) return;
	try {
		await service.stop({
			env: process.env,
			stdout: process.stdout
		});
	} catch (err) {
		runtime.error(`Gateway stop failed: ${String(err)}`);
	}
}
async function resetCommand(runtime, opts) {
	const interactive = !opts.nonInteractive;
	if (!interactive && !opts.yes) {
		runtime.error("Non-interactive mode requires --yes.");
		runtime.exit(1);
		return;
	}
	let scope = opts.scope;
	if (!scope) {
		if (!interactive) {
			runtime.error("Non-interactive mode requires --scope.");
			runtime.exit(1);
			return;
		}
		const selection = await selectStyled({
			message: "Reset scope",
			options: [
				{
					value: "config",
					label: "Config only",
					hint: "openclaw.json"
				},
				{
					value: "config+creds+sessions",
					label: "Config + credentials + sessions",
					hint: "keeps workspace + auth profiles"
				},
				{
					value: "full",
					label: "Full reset",
					hint: "state dir + workspace"
				}
			],
			initialValue: "config+creds+sessions"
		});
		if (isCancel(selection)) {
			cancel(stylePromptTitle("Reset cancelled.") ?? "Reset cancelled.");
			runtime.exit(0);
			return;
		}
		scope = selection;
	}
	if (![
		"config",
		"config+creds+sessions",
		"full"
	].includes(scope)) {
		runtime.error("Invalid --scope. Expected \"config\", \"config+creds+sessions\", or \"full\".");
		runtime.exit(1);
		return;
	}
	if (interactive && !opts.yes) {
		const ok = await confirm({ message: stylePromptMessage(`Proceed with ${scope} reset?`) });
		if (isCancel(ok) || !ok) {
			cancel(stylePromptTitle("Reset cancelled.") ?? "Reset cancelled.");
			runtime.exit(0);
			return;
		}
	}
	const dryRun = Boolean(opts.dryRun);
	const cfg = loadConfig();
	const stateDir = resolveStateDir();
	const configPath = resolveConfigPath();
	const oauthDir = resolveOAuthDir();
	const configInsideState = isPathWithin(configPath, stateDir);
	const oauthInsideState = isPathWithin(oauthDir, stateDir);
	const workspaceDirs = collectWorkspaceDirs(cfg);
	if (scope !== "config") if (dryRun) runtime.log("[dry-run] stop gateway service");
	else await stopGatewayIfRunning(runtime);
	if (scope === "config") {
		await removePath(configPath, runtime, {
			dryRun,
			label: configPath
		});
		return;
	}
	if (scope === "config+creds+sessions") {
		await removePath(configPath, runtime, {
			dryRun,
			label: configPath
		});
		await removePath(oauthDir, runtime, {
			dryRun,
			label: oauthDir
		});
		const sessionDirs = await listAgentSessionDirs(stateDir);
		for (const dir of sessionDirs) await removePath(dir, runtime, {
			dryRun,
			label: dir
		});
		runtime.log(`Next: ${formatCliCommand("openclaw onboard --install-daemon")}`);
		return;
	}
	if (scope === "full") {
		await removePath(stateDir, runtime, {
			dryRun,
			label: stateDir
		});
		if (!configInsideState) await removePath(configPath, runtime, {
			dryRun,
			label: configPath
		});
		if (!oauthInsideState) await removePath(oauthDir, runtime, {
			dryRun,
			label: oauthDir
		});
		for (const workspace of workspaceDirs) await removePath(workspace, runtime, {
			dryRun,
			label: workspace
		});
		runtime.log(`Next: ${formatCliCommand("openclaw onboard --install-daemon")}`);
		return;
	}
}

//#endregion
//#region src/commands/uninstall.ts
const multiselectStyled = (params) => multiselect({
	...params,
	message: stylePromptMessage(params.message),
	options: params.options.map((opt) => opt.hint === void 0 ? opt : {
		...opt,
		hint: stylePromptHint(opt.hint)
	})
});
function buildScopeSelection(opts) {
	const hadExplicit = Boolean(opts.all || opts.service || opts.state || opts.workspace || opts.app);
	const scopes = /* @__PURE__ */ new Set();
	if (opts.all || opts.service) scopes.add("service");
	if (opts.all || opts.state) scopes.add("state");
	if (opts.all || opts.workspace) scopes.add("workspace");
	if (opts.all || opts.app) scopes.add("app");
	return {
		scopes,
		hadExplicit
	};
}
async function stopAndUninstallService(runtime) {
	if (isNixMode) {
		runtime.error("Nix mode detected; service uninstall is disabled.");
		return false;
	}
	const service = resolveGatewayService();
	let loaded = false;
	try {
		loaded = await service.isLoaded({ env: process.env });
	} catch (err) {
		runtime.error(`Gateway service check failed: ${String(err)}`);
		return false;
	}
	if (!loaded) {
		runtime.log(`Gateway service ${service.notLoadedText}.`);
		return true;
	}
	try {
		await service.stop({
			env: process.env,
			stdout: process.stdout
		});
	} catch (err) {
		runtime.error(`Gateway stop failed: ${String(err)}`);
	}
	try {
		await service.uninstall({
			env: process.env,
			stdout: process.stdout
		});
		return true;
	} catch (err) {
		runtime.error(`Gateway uninstall failed: ${String(err)}`);
		return false;
	}
}
async function removeMacApp(runtime, dryRun) {
	if (process.platform !== "darwin") return;
	await removePath("/Applications/OpenClaw.app", runtime, {
		dryRun,
		label: "/Applications/OpenClaw.app"
	});
}
async function uninstallCommand(runtime, opts) {
	const { scopes, hadExplicit } = buildScopeSelection(opts);
	const interactive = !opts.nonInteractive;
	if (!interactive && !opts.yes) {
		runtime.error("Non-interactive mode requires --yes.");
		runtime.exit(1);
		return;
	}
	if (!hadExplicit) {
		if (!interactive) {
			runtime.error("Non-interactive mode requires explicit scopes (use --all).");
			runtime.exit(1);
			return;
		}
		const selection = await multiselectStyled({
			message: "Uninstall which components?",
			options: [
				{
					value: "service",
					label: "Gateway service",
					hint: "launchd / systemd / schtasks"
				},
				{
					value: "state",
					label: "State + config",
					hint: "~/.openclaw"
				},
				{
					value: "workspace",
					label: "Workspace",
					hint: "agent files"
				},
				{
					value: "app",
					label: "macOS app",
					hint: "/Applications/OpenClaw.app"
				}
			],
			initialValues: [
				"service",
				"state",
				"workspace"
			]
		});
		if (isCancel(selection)) {
			cancel(stylePromptTitle("Uninstall cancelled.") ?? "Uninstall cancelled.");
			runtime.exit(0);
			return;
		}
		for (const value of selection) scopes.add(value);
	}
	if (scopes.size === 0) {
		runtime.log("Nothing selected.");
		return;
	}
	if (interactive && !opts.yes) {
		const ok = await confirm({ message: stylePromptMessage("Proceed with uninstall?") });
		if (isCancel(ok) || !ok) {
			cancel(stylePromptTitle("Uninstall cancelled.") ?? "Uninstall cancelled.");
			runtime.exit(0);
			return;
		}
	}
	const dryRun = Boolean(opts.dryRun);
	const cfg = loadConfig();
	const stateDir = resolveStateDir();
	const configPath = resolveConfigPath();
	const oauthDir = resolveOAuthDir();
	const configInsideState = isPathWithin(configPath, stateDir);
	const oauthInsideState = isPathWithin(oauthDir, stateDir);
	const workspaceDirs = collectWorkspaceDirs(cfg);
	if (scopes.has("service")) if (dryRun) runtime.log("[dry-run] remove gateway service");
	else await stopAndUninstallService(runtime);
	if (scopes.has("state")) {
		await removePath(stateDir, runtime, {
			dryRun,
			label: stateDir
		});
		if (!configInsideState) await removePath(configPath, runtime, {
			dryRun,
			label: configPath
		});
		if (!oauthInsideState) await removePath(oauthDir, runtime, {
			dryRun,
			label: oauthDir
		});
	}
	if (scopes.has("workspace")) for (const workspace of workspaceDirs) await removePath(workspace, runtime, {
		dryRun,
		label: workspace
	});
	if (scopes.has("app")) await removeMacApp(runtime, dryRun);
	runtime.log("CLI still installed. Remove via npm/pnpm if desired.");
	if (scopes.has("state") && !scopes.has("workspace")) {
		const home = resolveHomeDir();
		if (home && workspaceDirs.some((dir) => dir.startsWith(path.resolve(home)))) runtime.log("Tip: workspaces were preserved. Re-run with --workspace to remove them.");
	}
}

//#endregion
//#region src/cli/program/register.maintenance.ts
function registerMaintenanceCommands(program) {
	program.command("doctor").description("Health checks + quick fixes for the gateway and channels").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/doctor", "docs.openclaw.ai/cli/doctor")}\n`).option("--no-workspace-suggestions", "Disable workspace memory system suggestions", false).option("--yes", "Accept defaults without prompting", false).option("--repair", "Apply recommended repairs without prompting", false).option("--fix", "Apply recommended repairs (alias for --repair)", false).option("--force", "Apply aggressive repairs (overwrites custom service config)", false).option("--non-interactive", "Run without prompts (safe migrations only)", false).option("--generate-gateway-token", "Generate and configure a gateway token", false).option("--deep", "Scan system services for extra gateway installs", false).action(async (opts) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			await doctorCommand(defaultRuntime, {
				workspaceSuggestions: opts.workspaceSuggestions,
				yes: Boolean(opts.yes),
				repair: Boolean(opts.repair) || Boolean(opts.fix),
				force: Boolean(opts.force),
				nonInteractive: Boolean(opts.nonInteractive),
				generateGatewayToken: Boolean(opts.generateGatewayToken),
				deep: Boolean(opts.deep)
			});
		});
	});
	program.command("dashboard").description("Open the Control UI with your current token").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/dashboard", "docs.openclaw.ai/cli/dashboard")}\n`).option("--no-open", "Print URL but do not launch a browser", false).action(async (opts) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			await dashboardCommand(defaultRuntime, { noOpen: Boolean(opts.noOpen) });
		});
	});
	program.command("reset").description("Reset local config/state (keeps the CLI installed)").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/reset", "docs.openclaw.ai/cli/reset")}\n`).option("--scope <scope>", "config|config+creds+sessions|full (default: interactive prompt)").option("--yes", "Skip confirmation prompts", false).option("--non-interactive", "Disable prompts (requires --scope + --yes)", false).option("--dry-run", "Print actions without removing files", false).action(async (opts) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			await resetCommand(defaultRuntime, {
				scope: opts.scope,
				yes: Boolean(opts.yes),
				nonInteractive: Boolean(opts.nonInteractive),
				dryRun: Boolean(opts.dryRun)
			});
		});
	});
	program.command("uninstall").description("Uninstall the gateway service + local data (CLI remains)").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/uninstall", "docs.openclaw.ai/cli/uninstall")}\n`).option("--service", "Remove the gateway service", false).option("--state", "Remove state + config", false).option("--workspace", "Remove workspace dirs", false).option("--app", "Remove the macOS app", false).option("--all", "Remove service + state + workspace + app", false).option("--yes", "Skip confirmation prompts", false).option("--non-interactive", "Disable prompts (requires --yes)", false).option("--dry-run", "Print actions without removing files", false).action(async (opts) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			await uninstallCommand(defaultRuntime, {
				service: Boolean(opts.service),
				state: Boolean(opts.state),
				workspace: Boolean(opts.workspace),
				app: Boolean(opts.app),
				all: Boolean(opts.all),
				yes: Boolean(opts.yes),
				nonInteractive: Boolean(opts.nonInteractive),
				dryRun: Boolean(opts.dryRun)
			});
		});
	});
}

//#endregion
export { registerMaintenanceCommands };