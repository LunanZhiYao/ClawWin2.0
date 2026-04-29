import "./paths-CyR9Pa1R.js";
import "./workspace-CAwOqECe.js";
import { Q as shouldLogVerbose, X as logVerbose } from "./exec-kNgoQ-Yt.js";
import "./agent-scope-mFm05wNX.js";
import "./image-ops-Db3kwMRr.js";
import "./boolean-Bb19hm9Y.js";
import "./model-auth-Bos4xjOH.js";
import "./config-Dr8z937s.js";
import "./github-copilot-token-BXEGgIt5.js";
import "./pi-model-discovery-Cexg1XRf.js";
import "./pi-embedded-helpers-CUD7UoUC.js";
import "./chrome-BaJk80VF.js";
import "./frontmatter-yyc9d0b4.js";
import "./store-Bx3kRvoj.js";
import "./paths-Ck4L046D.js";
import "./tool-images-BomM11M6.js";
import "./image-Drpoo6S0.js";
import "./redact-DcuzVizL.js";
import "./fetch-DNxVU_z5.js";
import { a as runCapability, l as isAudioAttachment, n as createMediaAttachmentCache, r as normalizeMediaAttachments, t as buildProviderRegistry } from "./runner-CfRx2Ecl.js";

//#region src/media-understanding/audio-preflight.ts
/**
* Transcribes the first audio attachment BEFORE mention checking.
* This allows voice notes to be processed in group chats with requireMention: true.
* Returns the transcript or undefined if transcription fails or no audio is found.
*/
async function transcribeFirstAudio(params) {
	const { ctx, cfg } = params;
	const audioConfig = cfg.tools?.media?.audio;
	if (!audioConfig || audioConfig.enabled === false) return;
	const attachments = normalizeMediaAttachments(ctx);
	if (!attachments || attachments.length === 0) return;
	const firstAudio = attachments.find((att) => att && isAudioAttachment(att) && !att.alreadyTranscribed);
	if (!firstAudio) return;
	if (shouldLogVerbose()) logVerbose(`audio-preflight: transcribing attachment ${firstAudio.index} for mention check`);
	const providerRegistry = buildProviderRegistry(params.providers);
	const cache = createMediaAttachmentCache(attachments);
	try {
		const result = await runCapability({
			capability: "audio",
			cfg,
			ctx,
			attachments: cache,
			media: attachments,
			agentDir: params.agentDir,
			providerRegistry,
			config: audioConfig,
			activeModel: params.activeModel
		});
		if (!result || result.outputs.length === 0) return;
		const audioOutput = result.outputs.find((output) => output.kind === "audio.transcription");
		if (!audioOutput || !audioOutput.text) return;
		firstAudio.alreadyTranscribed = true;
		if (shouldLogVerbose()) logVerbose(`audio-preflight: transcribed ${audioOutput.text.length} chars from attachment ${firstAudio.index}`);
		return audioOutput.text;
	} catch (err) {
		if (shouldLogVerbose()) logVerbose(`audio-preflight: transcription failed: ${String(err)}`);
		return;
	} finally {
		await cache.cleanup();
	}
}

//#endregion
export { transcribeFirstAudio };