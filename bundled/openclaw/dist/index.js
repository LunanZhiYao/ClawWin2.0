#!/usr/bin/env node
import "./paths-B4BZAPZh.js";
import { B as isRich, F as setVerbose, V as theme, d as defaultRuntime, l as visibleWidth, r as enableConsoleCapture } from "./subsystem-BbhgPUzd.js";
import { E as toWhatsappJid, h as normalizeE164, n as assertWebChannel } from "./utils-Bu8JlY-C.js";
import "./pi-embedded-helpers-DLeTj87G.js";
import { At as resolveCommitHash, t as getReplyFromConfig } from "./reply-CYMZTXlH.js";
import { n as runExec, t as runCommandWithTimeout } from "./exec-DrOTyHk4.js";
import "./agent-scope-dwzDG1b1.js";
import "./model-selection-ChgnVmWu.js";
import "./github-copilot-token-nncItI8D.js";
import { n as replaceCliName, r as resolveCliName } from "./command-format-ChfKqObn.js";
import "./boolean-BgXe2hyu.js";
import { r as normalizeEnv, t as isTruthyEnvValue } from "./env-Cw8GAYpM.js";
import { F as VERSION, I as loadDotEnv, i as loadConfig } from "./config-DTbrEHqs.js";
import "./manifest-registry-DoWer6SS.js";
import "./plugins-o2q9tVRq.js";
import { b as deriveSessionKey, i as loadSessionStore, s as saveSessionStore, x as resolveSessionKey } from "./sessions-BsVHT42i.js";
import { d as installUnhandledRejectionHandler, v as applyTemplate } from "./runner-STmMAoZV.js";
import "./image-nTaz5goe.js";
import "./pi-model-discovery-EwKVHlZB.js";
import "./sandbox-DuE0_fOw.js";
import "./chrome-DzwpOpfW.js";
import { _ as promptYesNo, g as ensureBinary } from "./auth-CkNWu3pU.js";
import "./server-context-DldOiQs9.js";
import "./skills-C1b_I-in.js";
import "./routes-BR0CuaB2.js";
import { r as formatUncaughtError } from "./errors-7ke8SPVn.js";
import "./paths-Bd-IpjA5.js";
import "./image-ops-CBI2il7g.js";
import "./store-DGrg_bt3.js";
import { i as handlePortError, n as describePortOwner, r as ensurePortAvailable, t as PortInUseError } from "./ports-DOIPQoJU.js";
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
import "./channel-activity-BokC07Jf.js";
import "./tables-cdhSq17V.js";
import "./send-zpmwLOS9.js";
import { t as formatDocsLink } from "./links-RE4B0nzB.js";
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
import { r as waitForever, t as monitorWebChannel } from "./channel-web-DaEV55-E.js";
import "./outbound-CZkiuZ5R.js";
import "./session-C71pkOhl.js";
import "./login-DCKpyH1r.js";
import { t as createDefaultDeps } from "./deps-DGzocYMK.js";
import { t as isMainModule } from "./is-main-QUEcHgHc.js";
import { t as ensureOpenClawCliOnPath } from "./path-env-BF1HHl7_.js";
import { t as assertSupportedRuntime } from "./runtime-guard-C5gtYrZ3.js";
import "./ports-D-gtHDZo.js";
import { a as hasHelpOrVersion, i as getVerboseFlag, n as getCommandPath } from "./argv-MLIUuMsK.js";
import { a as registerProgramCommands, n as setProgramContext } from "./program-context-BvTP81tH.js";
import "./catalog-KgzGgAlY.js";
import "./plugin-registry-jMjc_FA2.js";
import { n as resolveCliChannelOptions } from "./channel-options-BXDAqkWY.js";
import process$1 from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

//#region src/cli/program/context.ts
function createProgramContext() {
	const channelOptions = resolveCliChannelOptions();
	return {
		programVersion: VERSION,
		channelOptions,
		messageChannelOptions: channelOptions.join("|"),
		agentChannelOptions: ["last", ...channelOptions].join("|")
	};
}

//#endregion
//#region src/cli/tagline.ts
const DEFAULT_TAGLINE = "All your chats, one OpenClaw.";
const HOLIDAY_TAGLINES = {
	newYear: "New Year's Day: New year, new config—same old EADDRINUSE, but this time we resolve it like grown-ups.",
	lunarNewYear: "Lunar New Year: May your builds be lucky, your branches prosperous, and your merge conflicts chased away with fireworks.",
	christmas: "Christmas: Ho ho ho—Santa's little claw-sistant is here to ship joy, roll back chaos, and stash the keys safely.",
	eid: "Eid al-Fitr: Celebration mode: queues cleared, tasks completed, and good vibes committed to main with clean history.",
	diwali: "Diwali: Let the logs sparkle and the bugs flee—today we light up the terminal and ship with pride.",
	easter: "Easter: I found your missing environment variable—consider it a tiny CLI egg hunt with fewer jellybeans.",
	hanukkah: "Hanukkah: Eight nights, eight retries, zero shame—may your gateway stay lit and your deployments stay peaceful.",
	halloween: "Halloween: Spooky season: beware haunted dependencies, cursed caches, and the ghost of node_modules past.",
	thanksgiving: "Thanksgiving: Grateful for stable ports, working DNS, and a bot that reads the logs so nobody has to.",
	valentines: "Valentine's Day: Roses are typed, violets are piped—I'll automate the chores so you can spend time with humans."
};
const TAGLINES = [
	"Your terminal just grew claws—type something and let the bot pinch the busywork.",
	"Welcome to the command line: where dreams compile and confidence segfaults.",
	"I run on caffeine, JSON5, and the audacity of \"it worked on my machine.\"",
	"Gateway online—please keep hands, feet, and appendages inside the shell at all times.",
	"I speak fluent bash, mild sarcasm, and aggressive tab-completion energy.",
	"One CLI to rule them all, and one more restart because you changed the port.",
	"If it works, it's automation; if it breaks, it's a \"learning opportunity.\"",
	"Pairing codes exist because even bots believe in consent—and good security hygiene.",
	"Your .env is showing; don't worry, I'll pretend I didn't see it.",
	"I'll do the boring stuff while you dramatically stare at the logs like it's cinema.",
	"I'm not saying your workflow is chaotic... I'm just bringing a linter and a helmet.",
	"Type the command with confidence—nature will provide the stack trace if needed.",
	"I don't judge, but your missing API keys are absolutely judging you.",
	"I can grep it, git blame it, and gently roast it—pick your coping mechanism.",
	"Hot reload for config, cold sweat for deploys.",
	"I'm the assistant your terminal demanded, not the one your sleep schedule requested.",
	"I keep secrets like a vault... unless you print them in debug logs again.",
	"Automation with claws: minimal fuss, maximal pinch.",
	"I'm basically a Swiss Army knife, but with more opinions and fewer sharp edges.",
	"If you're lost, run doctor; if you're brave, run prod; if you're wise, run tests.",
	"Your task has been queued; your dignity has been deprecated.",
	"I can't fix your code taste, but I can fix your build and your backlog.",
	"I'm not magic—I'm just extremely persistent with retries and coping strategies.",
	"It's not \"failing,\" it's \"discovering new ways to configure the same thing wrong.\"",
	"Give me a workspace and I'll give you fewer tabs, fewer toggles, and more oxygen.",
	"I read logs so you can keep pretending you don't have to.",
	"If something's on fire, I can't extinguish it—but I can write a beautiful postmortem.",
	"I'll refactor your busywork like it owes me money.",
	"Say \"stop\" and I'll stop—say \"ship\" and we'll both learn a lesson.",
	"I'm the reason your shell history looks like a hacker-movie montage.",
	"I'm like tmux: confusing at first, then suddenly you can't live without me.",
	"I can run local, remote, or purely on vibes—results may vary with DNS.",
	"If you can describe it, I can probably automate it—or at least make it funnier.",
	"Your config is valid, your assumptions are not.",
	"I don't just autocomplete—I auto-commit (emotionally), then ask you to review (logically).",
	"Less clicking, more shipping, fewer \"where did that file go\" moments.",
	"Claws out, commit in—let's ship something mildly responsible.",
	"I'll butter your workflow like a lobster roll: messy, delicious, effective.",
	"Shell yeah—I'm here to pinch the toil and leave you the glory.",
	"If it's repetitive, I'll automate it; if it's hard, I'll bring jokes and a rollback plan.",
	"Because texting yourself reminders is so 2024.",
	"Your inbox, your infra, your rules.",
	"Turning \"I'll reply later\" into \"my bot replied instantly\".",
	"The only crab in your contacts you actually want to hear from. 🦞",
	"Chat automation for people who peaked at IRC.",
	"Because Siri wasn't answering at 3AM.",
	"IPC, but it's your phone.",
	"The UNIX philosophy meets your DMs.",
	"curl for conversations.",
	"Less middlemen, more messages.",
	"Ship fast, log faster.",
	"End-to-end encrypted, drama-to-drama excluded.",
	"The only bot that stays out of your training set.",
	"WhatsApp automation without the \"please accept our new privacy policy\".",
	"Chat APIs that don't require a Senate hearing.",
	"Meta wishes they shipped this fast.",
	"Because the right answer is usually a script.",
	"Your messages, your servers, your control.",
	"OpenAI-compatible, not OpenAI-dependent.",
	"iMessage green bubble energy, but for everyone.",
	"Siri's competent cousin.",
	"Works on Android. Crazy concept, we know.",
	"No $999 stand required.",
	"We ship features faster than Apple ships calculator updates.",
	"Your AI assistant, now without the $3,499 headset.",
	"Think different. Actually think.",
	"Ah, the fruit tree company! 🍎",
	"Greetings, Professor Falken",
	HOLIDAY_TAGLINES.newYear,
	HOLIDAY_TAGLINES.lunarNewYear,
	HOLIDAY_TAGLINES.christmas,
	HOLIDAY_TAGLINES.eid,
	HOLIDAY_TAGLINES.diwali,
	HOLIDAY_TAGLINES.easter,
	HOLIDAY_TAGLINES.hanukkah,
	HOLIDAY_TAGLINES.halloween,
	HOLIDAY_TAGLINES.thanksgiving,
	HOLIDAY_TAGLINES.valentines
];
const DAY_MS = 1440 * 60 * 1e3;
function utcParts(date) {
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth(),
		day: date.getUTCDate()
	};
}
const onMonthDay = (month, day) => (date) => {
	const parts = utcParts(date);
	return parts.month === month && parts.day === day;
};
const onSpecificDates = (dates, durationDays = 1) => (date) => {
	const parts = utcParts(date);
	return dates.some(([year, month, day]) => {
		if (parts.year !== year) return false;
		const start = Date.UTC(year, month, day);
		const current = Date.UTC(parts.year, parts.month, parts.day);
		return current >= start && current < start + durationDays * DAY_MS;
	});
};
const inYearWindow = (windows) => (date) => {
	const parts = utcParts(date);
	const window = windows.find((entry) => entry.year === parts.year);
	if (!window) return false;
	const start = Date.UTC(window.year, window.month, window.day);
	const current = Date.UTC(parts.year, parts.month, parts.day);
	return current >= start && current < start + window.duration * DAY_MS;
};
const isFourthThursdayOfNovember = (date) => {
	const parts = utcParts(date);
	if (parts.month !== 10) return false;
	const fourthThursday = 1 + (4 - new Date(Date.UTC(parts.year, 10, 1)).getUTCDay() + 7) % 7 + 21;
	return parts.day === fourthThursday;
};
const HOLIDAY_RULES = new Map([
	[HOLIDAY_TAGLINES.newYear, onMonthDay(0, 1)],
	[HOLIDAY_TAGLINES.lunarNewYear, onSpecificDates([
		[
			2025,
			0,
			29
		],
		[
			2026,
			1,
			17
		],
		[
			2027,
			1,
			6
		]
	], 1)],
	[HOLIDAY_TAGLINES.eid, onSpecificDates([
		[
			2025,
			2,
			30
		],
		[
			2025,
			2,
			31
		],
		[
			2026,
			2,
			20
		],
		[
			2027,
			2,
			10
		]
	], 1)],
	[HOLIDAY_TAGLINES.diwali, onSpecificDates([
		[
			2025,
			9,
			20
		],
		[
			2026,
			10,
			8
		],
		[
			2027,
			9,
			28
		]
	], 1)],
	[HOLIDAY_TAGLINES.easter, onSpecificDates([
		[
			2025,
			3,
			20
		],
		[
			2026,
			3,
			5
		],
		[
			2027,
			2,
			28
		]
	], 1)],
	[HOLIDAY_TAGLINES.hanukkah, inYearWindow([
		{
			year: 2025,
			month: 11,
			day: 15,
			duration: 8
		},
		{
			year: 2026,
			month: 11,
			day: 5,
			duration: 8
		},
		{
			year: 2027,
			month: 11,
			day: 25,
			duration: 8
		}
	])],
	[HOLIDAY_TAGLINES.halloween, onMonthDay(9, 31)],
	[HOLIDAY_TAGLINES.thanksgiving, isFourthThursdayOfNovember],
	[HOLIDAY_TAGLINES.valentines, onMonthDay(1, 14)],
	[HOLIDAY_TAGLINES.christmas, onMonthDay(11, 25)]
]);
function isTaglineActive(tagline, date) {
	const rule = HOLIDAY_RULES.get(tagline);
	if (!rule) return true;
	return rule(date);
}
function activeTaglines(options = {}) {
	if (TAGLINES.length === 0) return [DEFAULT_TAGLINE];
	const today = options.now ? options.now() : /* @__PURE__ */ new Date();
	const filtered = TAGLINES.filter((tagline) => isTaglineActive(tagline, today));
	return filtered.length > 0 ? filtered : TAGLINES;
}
function pickTagline(options = {}) {
	const override = (options.env ?? process.env)?.OPENCLAW_TAGLINE_INDEX;
	if (override !== void 0) {
		const parsed = Number.parseInt(override, 10);
		if (!Number.isNaN(parsed) && parsed >= 0) {
			const pool = TAGLINES.length > 0 ? TAGLINES : [DEFAULT_TAGLINE];
			return pool[parsed % pool.length];
		}
	}
	const pool = activeTaglines(options);
	const rand = options.random ?? Math.random;
	return pool[Math.floor(rand() * pool.length) % pool.length];
}

//#endregion
//#region src/cli/banner.ts
let bannerEmitted = false;
const graphemeSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
const hasJsonFlag = (argv) => argv.some((arg) => arg === "--json" || arg.startsWith("--json="));
const hasVersionFlag = (argv) => argv.some((arg) => arg === "--version" || arg === "-V" || arg === "-v");
function formatCliBannerLine(version, options = {}) {
	const commitLabel = options.commit ?? resolveCommitHash({ env: options.env }) ?? "unknown";
	const tagline = pickTagline(options);
	const rich = options.richTty ?? isRich();
	const title = "🦞 OpenClaw";
	const columns = options.columns ?? process.stdout.columns ?? 120;
	const plainFullLine = `${title} ${version} (${commitLabel}) — ${tagline}`;
	const fitsOnOneLine = visibleWidth(plainFullLine) <= columns;
	if (rich) {
		if (fitsOnOneLine) return `${theme.heading(title)} ${theme.info(version)} ${theme.muted(`(${commitLabel})`)} ${theme.muted("—")} ${theme.accentDim(tagline)}`;
		return `${`${theme.heading(title)} ${theme.info(version)} ${theme.muted(`(${commitLabel})`)}`}\n${`${" ".repeat(3)}${theme.accentDim(tagline)}`}`;
	}
	if (fitsOnOneLine) return plainFullLine;
	return `${`${title} ${version} (${commitLabel})`}\n${`${" ".repeat(3)}${tagline}`}`;
}
function emitCliBanner(version, options = {}) {
	if (bannerEmitted) return;
	const argv = options.argv ?? process.argv;
	if (!process.stdout.isTTY) return;
	if (hasJsonFlag(argv)) return;
	if (hasVersionFlag(argv)) return;
	const line = formatCliBannerLine(version, options);
	process.stdout.write(`\n${line}\n\n`);
	bannerEmitted = true;
}
function hasEmittedCliBanner() {
	return bannerEmitted;
}

//#endregion
//#region src/cli/program/help.ts
const CLI_NAME = resolveCliName();
const EXAMPLES = [
	["openclaw channels login --verbose", "Link personal WhatsApp Web and show QR + connection logs."],
	["openclaw message send --target +15555550123 --message \"Hi\" --json", "Send via your web session and print JSON result."],
	["openclaw gateway --port 18789", "Run the WebSocket Gateway locally."],
	["openclaw --dev gateway", "Run a dev Gateway (isolated state/config) on ws://127.0.0.1:19001."],
	["openclaw gateway --force", "Kill anything bound to the default gateway port, then start it."],
	["openclaw gateway ...", "Gateway control via WebSocket."],
	["openclaw agent --to +15555550123 --message \"Run summary\" --deliver", "Talk directly to the agent using the Gateway; optionally send the WhatsApp reply."],
	["openclaw message send --channel telegram --target @mychat --message \"Hi\"", "Send via your Telegram bot."]
];
function configureProgramHelp(program, ctx) {
	program.name(CLI_NAME).description("").version(ctx.programVersion).option("--dev", "Dev profile: isolate state under ~/.openclaw-dev, default gateway port 19001, and shift derived ports (browser/canvas)").option("--profile <name>", "Use a named profile (isolates OPENCLAW_STATE_DIR/OPENCLAW_CONFIG_PATH under ~/.openclaw-<name>)");
	program.option("--no-color", "Disable ANSI colors", false);
	program.configureHelp({
		sortSubcommands: true,
		sortOptions: true,
		optionTerm: (option) => theme.option(option.flags),
		subcommandTerm: (cmd) => theme.command(cmd.name())
	});
	program.configureOutput({
		writeOut: (str) => {
			const colored = str.replace(/^Usage:/gm, theme.heading("Usage:")).replace(/^Options:/gm, theme.heading("Options:")).replace(/^Commands:/gm, theme.heading("Commands:"));
			process.stdout.write(colored);
		},
		writeErr: (str) => process.stderr.write(str),
		outputError: (str, write) => write(theme.error(str))
	});
	if (process.argv.includes("-V") || process.argv.includes("--version") || process.argv.includes("-v")) {
		console.log(ctx.programVersion);
		process.exit(0);
	}
	program.addHelpText("beforeAll", () => {
		if (hasEmittedCliBanner()) return "";
		const rich = isRich();
		return `\n${formatCliBannerLine(ctx.programVersion, { richTty: rich })}\n`;
	});
	const fmtExamples = EXAMPLES.map(([cmd, desc]) => `  ${theme.command(replaceCliName(cmd, CLI_NAME))}\n    ${theme.muted(desc)}`).join("\n");
	program.addHelpText("afterAll", ({ command }) => {
		if (command !== program) return "";
		const docs = formatDocsLink("/cli", "docs.openclaw.ai/cli");
		return `\n${theme.heading("Examples:")}\n${fmtExamples}\n\n${theme.muted("Docs:")} ${docs}\n`;
	});
}

//#endregion
//#region src/cli/program/preaction.ts
function setProcessTitleForCommand(actionCommand) {
	let current = actionCommand;
	while (current.parent && current.parent.parent) current = current.parent;
	const name = current.name();
	const cliName = resolveCliName();
	if (!name || name === cliName) return;
	process.title = `${cliName}-${name}`;
}
const PLUGIN_REQUIRED_COMMANDS = new Set([
	"message",
	"channels",
	"directory"
]);
function registerPreActionHooks(program, programVersion) {
	program.hook("preAction", async (_thisCommand, actionCommand) => {
		setProcessTitleForCommand(actionCommand);
		const argv = process.argv;
		if (hasHelpOrVersion(argv)) return;
		const commandPath = getCommandPath(argv, 2);
		if (!(isTruthyEnvValue(process.env.OPENCLAW_HIDE_BANNER) || commandPath[0] === "update" || commandPath[0] === "completion" || commandPath[0] === "plugins" && commandPath[1] === "update")) emitCliBanner(programVersion);
		const verbose = getVerboseFlag(argv, { includeDebug: true });
		setVerbose(verbose);
		if (!verbose) process.env.NODE_NO_WARNINGS ??= "1";
		if (commandPath[0] === "doctor" || commandPath[0] === "completion") return;
		const { ensureConfigReady } = await import("./config-guard-DV2_DKuj.js");
		await ensureConfigReady({
			runtime: defaultRuntime,
			commandPath
		});
		if (PLUGIN_REQUIRED_COMMANDS.has(commandPath[0])) {
			const { ensurePluginRegistryLoaded } = await import("./plugin-registry-jMjc_FA2.js").then((n) => n.n);
			ensurePluginRegistryLoaded();
		}
	});
}

//#endregion
//#region src/cli/program/build-program.ts
function buildProgram() {
	const program = new Command();
	const ctx = createProgramContext();
	const argv = process.argv;
	setProgramContext(program, ctx);
	configureProgramHelp(program, ctx);
	registerPreActionHooks(program, ctx.programVersion);
	registerProgramCommands(program, ctx, argv);
	return program;
}

//#endregion
//#region src/index.ts
loadDotEnv({ quiet: true });
normalizeEnv();
ensureOpenClawCliOnPath();
enableConsoleCapture();
assertSupportedRuntime();
const program = buildProgram();
if (isMainModule({ currentFile: fileURLToPath(import.meta.url) })) {
	installUnhandledRejectionHandler();
	process$1.on("uncaughtException", (error) => {
		console.error("[openclaw] Uncaught exception:", formatUncaughtError(error));
		process$1.exit(1);
	});
	program.parseAsync(process$1.argv).catch((err) => {
		console.error("[openclaw] CLI failed:", formatUncaughtError(err));
		process$1.exit(1);
	});
}

//#endregion
export { PortInUseError, applyTemplate, assertWebChannel, createDefaultDeps, deriveSessionKey, describePortOwner, ensureBinary, ensurePortAvailable, getReplyFromConfig, handlePortError, loadConfig, loadSessionStore, monitorWebChannel, normalizeE164, promptYesNo, resolveSessionKey, resolveStorePath, runCommandWithTimeout, runExec, saveSessionStore, toWhatsappJid, waitForever };