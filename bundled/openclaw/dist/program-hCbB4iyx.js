import { Ct as hasHelpOrVersion, D as setVerbose, M as isRich, N as theme, _t as getCommandPath, g as defaultRuntime, n as isTruthyEnvValue, xt as getVerboseFlag } from "./entry.js";
import "./auth-profiles-BWqNRMgG.js";
import { n as replaceCliName, r as resolveCliName } from "./command-format-BA3gs9CO.js";
import "./utils-DZM-aXiE.js";
import "./exec-aioTkwpP.js";
import "./agent-scope-D-q7eKVm.js";
import "./github-copilot-token-Cqx9_dJi.js";
import "./pi-model-discovery-EhM2JAQo.js";
import "./skills-_fFRgbPu.js";
import "./manifest-registry-By5_tzJo.js";
import { F as VERSION } from "./config-Dhccn237.js";
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
import "./plugin-registry-DPEAML-L.js";
import { n as resolveCliChannelOptions } from "./channel-options-DcNO8fro.js";
import "./register.subclis-pUGBAqMo.js";
import { i as registerProgramCommands } from "./command-registry-BwbTINHh.js";
import { r as setProgramContext } from "./program-context-BPp9Yja6.js";
import { t as forceFreePort } from "./ports-Cx793dSX.js";
import { n as formatCliBannerLine, r as hasEmittedCliBanner, t as emitCliBanner } from "./banner-Cv2ECmqz.js";
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
		const { ensureConfigReady } = await import("./config-guard-CChU2MB8.js").then((n) => n.t);
		await ensureConfigReady({
			runtime: defaultRuntime,
			commandPath
		});
		if (PLUGIN_REQUIRED_COMMANDS.has(commandPath[0])) {
			const { ensurePluginRegistryLoaded } = await import("./plugin-registry-DPEAML-L.js").then((n) => n.n);
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
export { buildProgram };