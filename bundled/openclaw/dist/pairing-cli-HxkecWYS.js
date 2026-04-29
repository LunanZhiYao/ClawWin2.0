import "./paths-B4BZAPZh.js";
import { V as theme, d as defaultRuntime } from "./subsystem-BbhgPUzd.js";
import "./utils-Bu8JlY-C.js";
import "./exec-DrOTyHk4.js";
import "./agent-scope-dwzDG1b1.js";
import "./model-selection-ChgnVmWu.js";
import "./github-copilot-token-nncItI8D.js";
import { t as formatCliCommand } from "./command-format-ChfKqObn.js";
import "./boolean-BgXe2hyu.js";
import "./env-Cw8GAYpM.js";
import { i as loadConfig } from "./config-DTbrEHqs.js";
import "./manifest-registry-DoWer6SS.js";
import { r as normalizeChannelId } from "./plugins-o2q9tVRq.js";
import "./logging-Bgrm4o7g.js";
import "./accounts-CHuAbvtH.js";
import { t as formatDocsLink } from "./links-RE4B0nzB.js";
import { c as listPairingChannels, l as notifyPairingApproved, n as approveChannelPairingCode, r as listChannelPairingRequests } from "./pairing-store-CpVA0Zrb.js";
import { t as resolvePairingIdLabel } from "./pairing-labels-DRgmeoqx.js";
import { t as renderTable } from "./table-BLMSXjAe.js";

//#region src/cli/pairing-cli.ts
/** Parse channel, allowing extension channels not in core registry. */
function parseChannel(raw, channels) {
	const value = (typeof raw === "string" ? raw : typeof raw === "number" || typeof raw === "boolean" ? String(raw) : "").trim().toLowerCase();
	if (!value) throw new Error("Channel required");
	const normalized = normalizeChannelId(value);
	if (normalized) {
		if (!channels.includes(normalized)) throw new Error(`Channel ${normalized} does not support pairing`);
		return normalized;
	}
	if (/^[a-z][a-z0-9_-]{0,63}$/.test(value)) return value;
	throw new Error(`Invalid channel: ${value}`);
}
async function notifyApproved(channel, id) {
	await notifyPairingApproved({
		channelId: channel,
		id,
		cfg: loadConfig()
	});
}
function registerPairingCli(program) {
	const channels = listPairingChannels();
	const pairing = program.command("pairing").description("Secure DM pairing (approve inbound requests)").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/pairing", "docs.openclaw.ai/cli/pairing")}\n`);
	pairing.command("list").description("List pending pairing requests").option("--channel <channel>", `Channel (${channels.join(", ")})`).argument("[channel]", `Channel (${channels.join(", ")})`).option("--json", "Print JSON", false).action(async (channelArg, opts) => {
		const channelRaw = opts.channel ?? channelArg;
		if (!channelRaw) throw new Error(`Channel required. Use --channel <channel> or pass it as the first argument (expected one of: ${channels.join(", ")})`);
		const channel = parseChannel(channelRaw, channels);
		const requests = await listChannelPairingRequests(channel);
		if (opts.json) {
			defaultRuntime.log(JSON.stringify({
				channel,
				requests
			}, null, 2));
			return;
		}
		if (requests.length === 0) {
			defaultRuntime.log(theme.muted(`No pending ${channel} pairing requests.`));
			return;
		}
		const idLabel = resolvePairingIdLabel(channel);
		const tableWidth = Math.max(60, (process.stdout.columns ?? 120) - 1);
		defaultRuntime.log(`${theme.heading("Pairing requests")} ${theme.muted(`(${requests.length})`)}`);
		defaultRuntime.log(renderTable({
			width: tableWidth,
			columns: [
				{
					key: "Code",
					header: "Code",
					minWidth: 10
				},
				{
					key: "ID",
					header: idLabel,
					minWidth: 12,
					flex: true
				},
				{
					key: "Meta",
					header: "Meta",
					minWidth: 8,
					flex: true
				},
				{
					key: "Requested",
					header: "Requested",
					minWidth: 12
				}
			],
			rows: requests.map((r) => ({
				Code: r.code,
				ID: r.id,
				Meta: r.meta ? JSON.stringify(r.meta) : "",
				Requested: r.createdAt
			}))
		}).trimEnd());
	});
	pairing.command("approve").description("Approve a pairing code and allow that sender").option("--channel <channel>", `Channel (${channels.join(", ")})`).argument("<codeOrChannel>", "Pairing code (or channel when using 2 args)").argument("[code]", "Pairing code (when channel is passed as the 1st arg)").option("--notify", "Notify the requester on the same channel", false).action(async (codeOrChannel, code, opts) => {
		const channelRaw = opts.channel ?? codeOrChannel;
		const resolvedCode = opts.channel ? codeOrChannel : code;
		if (!opts.channel && !code) throw new Error(`Usage: ${formatCliCommand("openclaw pairing approve <channel> <code>")} (or: ${formatCliCommand("openclaw pairing approve --channel <channel> <code>")})`);
		if (opts.channel && code != null) throw new Error(`Too many arguments. Use: ${formatCliCommand("openclaw pairing approve --channel <channel> <code>")}`);
		const channel = parseChannel(channelRaw, channels);
		const approved = await approveChannelPairingCode({
			channel,
			code: String(resolvedCode)
		});
		if (!approved) throw new Error(`No pending pairing request found for code: ${String(resolvedCode)}`);
		defaultRuntime.log(`${theme.success("Approved")} ${theme.muted(channel)} sender ${theme.command(approved.id)}.`);
		if (!opts.notify) return;
		await notifyApproved(channel, approved.id).catch((err) => {
			defaultRuntime.log(theme.warn(`Failed to notify requester: ${String(err)}`));
		});
	});
}

//#endregion
export { registerPairingCli };