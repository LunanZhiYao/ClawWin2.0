import "./paths-Bp5uKvNR.js";
import "./agent-scope-DRERpO5H.js";
import "./exec-DWBzVcJJ.js";
import "./model-selection-BvTZ4qvn.js";
import "./github-copilot-token-DZwwYztr.js";
import "./image-ops-uJWMortG.js";
import "./config-D9FGRQVc.js";
import "./tool-images-BSZO1oDZ.js";
import { i as jsonResult, l as readStringParam, o as readReactionParams, t as createActionGate } from "./common-DjjVuZlK.js";
import "./ir-BWNYsMzM.js";
import "./fetch-Blco4SB7.js";
import "./active-listener-DIBVk1Vy.js";
import { r as sendReactionWhatsApp } from "./outbound-Jix5RYPb.js";

//#region src/agents/tools/whatsapp-actions.ts
async function handleWhatsAppAction(params, cfg) {
	const action = readStringParam(params, "action", { required: true });
	const isActionEnabled = createActionGate(cfg.channels?.whatsapp?.actions);
	if (action === "react") {
		if (!isActionEnabled("reactions")) throw new Error("WhatsApp reactions are disabled.");
		const chatJid = readStringParam(params, "chatJid", { required: true });
		const messageId = readStringParam(params, "messageId", { required: true });
		const { emoji, remove, isEmpty } = readReactionParams(params, { removeErrorMessage: "Emoji is required to remove a WhatsApp reaction." });
		const participant = readStringParam(params, "participant");
		const accountId = readStringParam(params, "accountId");
		const fromMeRaw = params.fromMe;
		await sendReactionWhatsApp(chatJid, messageId, remove ? "" : emoji, {
			verbose: false,
			fromMe: typeof fromMeRaw === "boolean" ? fromMeRaw : void 0,
			participant: participant ?? void 0,
			accountId: accountId ?? void 0
		});
		if (!remove && !isEmpty) return jsonResult({
			ok: true,
			added: emoji
		});
		return jsonResult({
			ok: true,
			removed: true
		});
	}
	throw new Error(`Unsupported WhatsApp action: ${action}`);
}

//#endregion
export { handleWhatsAppAction };