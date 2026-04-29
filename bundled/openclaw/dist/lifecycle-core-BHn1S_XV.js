import { d as resolveIsNixMode } from "./paths-B4BZAPZh.js";
import { W as getResolvedLoggerSettings, d as defaultRuntime } from "./subsystem-BbhgPUzd.js";
import { t as formatCliCommand } from "./command-format-ChfKqObn.js";
import { c as pickPrimaryLanIPv4 } from "./ws-DDh2NOiX.js";
import { t as isWSL } from "./wsl-DpLn9LrE.js";
import { d as resolveGatewaySystemdServiceName, f as resolveGatewayWindowsTaskName, l as resolveGatewayLaunchAgentLabel } from "./constants-CjK-0Fjq.js";
import { s as resolveGatewayLogPaths } from "./service-BmdpdrKO.js";
import { r as isSystemdUserServiceAvailable } from "./systemd-CfWFfqz_.js";
import { n as renderSystemdUnavailableHints } from "./systemd-hints-CSiwR06s.js";
import { Writable } from "node:stream";

//#region src/cli/daemon-cli/response.ts
function emitDaemonActionJson(payload) {
	defaultRuntime.log(JSON.stringify(payload, null, 2));
}
function buildDaemonServiceSnapshot(service, loaded) {
	return {
		label: service.label,
		loaded,
		loadedText: service.loadedText,
		notLoadedText: service.notLoadedText
	};
}
function createNullWriter() {
	return new Writable({ write(_chunk, _encoding, callback) {
		callback();
	} });
}

//#endregion
//#region src/cli/daemon-cli/shared.ts
function parsePort(raw) {
	if (raw === void 0 || raw === null) return null;
	const value = typeof raw === "string" ? raw : typeof raw === "number" || typeof raw === "bigint" ? raw.toString() : null;
	if (value === null) return null;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return null;
	return parsed;
}
function parsePortFromArgs(programArguments) {
	if (!programArguments?.length) return null;
	for (let i = 0; i < programArguments.length; i += 1) {
		const arg = programArguments[i];
		if (arg === "--port") {
			const next = programArguments[i + 1];
			const parsed = parsePort(next);
			if (parsed) return parsed;
		}
		if (arg?.startsWith("--port=")) {
			const parsed = parsePort(arg.split("=", 2)[1]);
			if (parsed) return parsed;
		}
	}
	return null;
}
function pickProbeHostForBind(bindMode, tailnetIPv4, customBindHost) {
	if (bindMode === "custom" && customBindHost?.trim()) return customBindHost.trim();
	if (bindMode === "tailnet") return tailnetIPv4 ?? "127.0.0.1";
	if (bindMode === "lan") return pickPrimaryLanIPv4() ?? "127.0.0.1";
	return "127.0.0.1";
}
const SAFE_DAEMON_ENV_KEYS = [
	"OPENCLAW_PROFILE",
	"OPENCLAW_STATE_DIR",
	"OPENCLAW_CONFIG_PATH",
	"OPENCLAW_GATEWAY_PORT",
	"OPENCLAW_NIX_MODE"
];
function filterDaemonEnv(env) {
	if (!env) return {};
	const filtered = {};
	for (const key of SAFE_DAEMON_ENV_KEYS) {
		const value = env[key];
		if (!value?.trim()) continue;
		filtered[key] = value.trim();
	}
	return filtered;
}
function safeDaemonEnv(env) {
	const filtered = filterDaemonEnv(env);
	return Object.entries(filtered).map(([key, value]) => `${key}=${value}`);
}
function normalizeListenerAddress(raw) {
	let value = raw.trim();
	if (!value) return value;
	value = value.replace(/^TCP\s+/i, "");
	value = value.replace(/\s+\(LISTEN\)\s*$/i, "");
	return value.trim();
}
function renderRuntimeHints(runtime, env = process.env) {
	if (!runtime) return [];
	const hints = [];
	const fileLog = (() => {
		try {
			return getResolvedLoggerSettings().file;
		} catch {
			return null;
		}
	})();
	if (runtime.missingUnit) {
		hints.push(`Service not installed. Run: ${formatCliCommand("openclaw gateway install", env)}`);
		if (fileLog) hints.push(`File logs: ${fileLog}`);
		return hints;
	}
	if (runtime.status === "stopped") {
		if (fileLog) hints.push(`File logs: ${fileLog}`);
		if (process.platform === "darwin") {
			const logs = resolveGatewayLogPaths(env);
			hints.push(`Launchd stdout (if installed): ${logs.stdoutPath}`);
			hints.push(`Launchd stderr (if installed): ${logs.stderrPath}`);
		} else if (process.platform === "linux") {
			const unit = resolveGatewaySystemdServiceName(env.OPENCLAW_PROFILE);
			hints.push(`Logs: journalctl --user -u ${unit}.service -n 200 --no-pager`);
		} else if (process.platform === "win32") {
			const task = resolveGatewayWindowsTaskName(env.OPENCLAW_PROFILE);
			hints.push(`Logs: schtasks /Query /TN "${task}" /V /FO LIST`);
		}
	}
	return hints;
}
function renderGatewayServiceStartHints(env = process.env) {
	const base = [formatCliCommand("openclaw gateway install", env), formatCliCommand("openclaw gateway", env)];
	const profile = env.OPENCLAW_PROFILE;
	switch (process.platform) {
		case "darwin": {
			const label = resolveGatewayLaunchAgentLabel(profile);
			return [...base, `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/${label}.plist`];
		}
		case "linux": {
			const unit = resolveGatewaySystemdServiceName(profile);
			return [...base, `systemctl --user start ${unit}.service`];
		}
		case "win32": {
			const task = resolveGatewayWindowsTaskName(profile);
			return [...base, `schtasks /Run /TN "${task}"`];
		}
		default: return base;
	}
}

//#endregion
//#region src/cli/daemon-cli/lifecycle-core.ts
async function maybeAugmentSystemdHints(hints) {
	if (process.platform !== "linux") return hints;
	if (await isSystemdUserServiceAvailable().catch(() => false)) return hints;
	return [...hints, ...renderSystemdUnavailableHints({ wsl: await isWSL() })];
}
function createActionIO(params) {
	const stdout = params.json ? createNullWriter() : process.stdout;
	const emit = (payload) => {
		if (!params.json) return;
		emitDaemonActionJson({
			action: params.action,
			...payload
		});
	};
	const fail = (message, hints) => {
		if (params.json) emit({
			ok: false,
			error: message,
			hints
		});
		else defaultRuntime.error(message);
		defaultRuntime.exit(1);
	};
	return {
		stdout,
		emit,
		fail
	};
}
async function runServiceUninstall(params) {
	const { stdout, emit, fail } = createActionIO({
		action: "uninstall",
		json: Boolean(params.opts?.json)
	});
	if (resolveIsNixMode(process.env)) {
		fail("Nix mode detected; service uninstall is disabled.");
		return;
	}
	let loaded = false;
	try {
		loaded = await params.service.isLoaded({ env: process.env });
	} catch {
		loaded = false;
	}
	if (loaded && params.stopBeforeUninstall) try {
		await params.service.stop({
			env: process.env,
			stdout
		});
	} catch {}
	try {
		await params.service.uninstall({
			env: process.env,
			stdout
		});
	} catch (err) {
		fail(`${params.serviceNoun} uninstall failed: ${String(err)}`);
		return;
	}
	loaded = false;
	try {
		loaded = await params.service.isLoaded({ env: process.env });
	} catch {
		loaded = false;
	}
	if (loaded && params.assertNotLoadedAfterUninstall) {
		fail(`${params.serviceNoun} service still loaded after uninstall.`);
		return;
	}
	emit({
		ok: true,
		result: "uninstalled",
		service: buildDaemonServiceSnapshot(params.service, loaded)
	});
}
async function runServiceStart(params) {
	const json = Boolean(params.opts?.json);
	const { stdout, emit, fail } = createActionIO({
		action: "start",
		json
	});
	let loaded = false;
	try {
		loaded = await params.service.isLoaded({ env: process.env });
	} catch (err) {
		fail(`${params.serviceNoun} service check failed: ${String(err)}`);
		return;
	}
	if (!loaded) {
		const hints = await maybeAugmentSystemdHints(params.renderStartHints());
		emit({
			ok: true,
			result: "not-loaded",
			message: `${params.serviceNoun} service ${params.service.notLoadedText}.`,
			hints,
			service: buildDaemonServiceSnapshot(params.service, loaded)
		});
		if (!json) {
			defaultRuntime.log(`${params.serviceNoun} service ${params.service.notLoadedText}.`);
			for (const hint of hints) defaultRuntime.log(`Start with: ${hint}`);
		}
		return;
	}
	try {
		await params.service.restart({
			env: process.env,
			stdout
		});
	} catch (err) {
		const hints = params.renderStartHints();
		fail(`${params.serviceNoun} start failed: ${String(err)}`, hints);
		return;
	}
	let started = true;
	try {
		started = await params.service.isLoaded({ env: process.env });
	} catch {
		started = true;
	}
	emit({
		ok: true,
		result: "started",
		service: buildDaemonServiceSnapshot(params.service, started)
	});
}
async function runServiceStop(params) {
	const json = Boolean(params.opts?.json);
	const { stdout, emit, fail } = createActionIO({
		action: "stop",
		json
	});
	let loaded = false;
	try {
		loaded = await params.service.isLoaded({ env: process.env });
	} catch (err) {
		fail(`${params.serviceNoun} service check failed: ${String(err)}`);
		return;
	}
	if (!loaded) {
		emit({
			ok: true,
			result: "not-loaded",
			message: `${params.serviceNoun} service ${params.service.notLoadedText}.`,
			service: buildDaemonServiceSnapshot(params.service, loaded)
		});
		if (!json) defaultRuntime.log(`${params.serviceNoun} service ${params.service.notLoadedText}.`);
		return;
	}
	try {
		await params.service.stop({
			env: process.env,
			stdout
		});
	} catch (err) {
		fail(`${params.serviceNoun} stop failed: ${String(err)}`);
		return;
	}
	let stopped = false;
	try {
		stopped = await params.service.isLoaded({ env: process.env });
	} catch {
		stopped = false;
	}
	emit({
		ok: true,
		result: "stopped",
		service: buildDaemonServiceSnapshot(params.service, stopped)
	});
}
async function runServiceRestart(params) {
	const json = Boolean(params.opts?.json);
	const { stdout, emit, fail } = createActionIO({
		action: "restart",
		json
	});
	let loaded = false;
	try {
		loaded = await params.service.isLoaded({ env: process.env });
	} catch (err) {
		fail(`${params.serviceNoun} service check failed: ${String(err)}`);
		return false;
	}
	if (!loaded) {
		const hints = await maybeAugmentSystemdHints(params.renderStartHints());
		emit({
			ok: true,
			result: "not-loaded",
			message: `${params.serviceNoun} service ${params.service.notLoadedText}.`,
			hints,
			service: buildDaemonServiceSnapshot(params.service, loaded)
		});
		if (!json) {
			defaultRuntime.log(`${params.serviceNoun} service ${params.service.notLoadedText}.`);
			for (const hint of hints) defaultRuntime.log(`Start with: ${hint}`);
		}
		return false;
	}
	try {
		await params.service.restart({
			env: process.env,
			stdout
		});
		let restarted = true;
		try {
			restarted = await params.service.isLoaded({ env: process.env });
		} catch {
			restarted = true;
		}
		emit({
			ok: true,
			result: "restarted",
			service: buildDaemonServiceSnapshot(params.service, restarted)
		});
		return true;
	} catch (err) {
		const hints = params.renderStartHints();
		fail(`${params.serviceNoun} restart failed: ${String(err)}`, hints);
		return false;
	}
}

//#endregion
export { filterDaemonEnv as a, parsePortFromArgs as c, renderRuntimeHints as d, safeDaemonEnv as f, emitDaemonActionJson as h, runServiceUninstall as i, pickProbeHostForBind as l, createNullWriter as m, runServiceStart as n, normalizeListenerAddress as o, buildDaemonServiceSnapshot as p, runServiceStop as r, parsePort as s, runServiceRestart as t, renderGatewayServiceStartHints as u };