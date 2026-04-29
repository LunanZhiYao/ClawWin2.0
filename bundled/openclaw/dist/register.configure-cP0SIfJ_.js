import { N as theme, g as defaultRuntime } from "./entry.js";
import "./auth-profiles-BWqNRMgG.js";
import "./utils-DZM-aXiE.js";
import "./exec-aioTkwpP.js";
import "./agent-scope-D-q7eKVm.js";
import "./github-copilot-token-Cqx9_dJi.js";
import "./pi-model-discovery-EhM2JAQo.js";
import "./skills-_fFRgbPu.js";
import "./manifest-registry-By5_tzJo.js";
import "./skills-status-qI8rBmks.js";
import "./config-Dhccn237.js";
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
import "./daemon-runtime-DjNAwwST.js";
import "./service-7hnvi87Y.js";
import "./systemd-BP_hPj6J.js";
import "./widearea-dns-DGKP2o1l.js";
import "./onboard-skills-Sz8-LdAo.js";
import "./health-MCmtGT7n.js";
import "./health-format-BemPCTHE.js";
import "./auth-choice-Cai1xZb-.js";
import "./github-copilot-auth-BeXkhisw.js";
import "./logging-CL5j2Kfg.js";
import "./systemd-linger-CfNmUMbG.js";
import { CONFIGURE_WIZARD_SECTIONS, configureCommand, configureCommandWithSections } from "./configure-C3kYcCdO.js";

//#region src/cli/program/register.configure.ts
function registerConfigureCommand(program) {
	program.command("configure").description("Interactive prompt to set up credentials, devices, and agent defaults").addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/configure", "docs.openclaw.ai/cli/configure")}\n`).option("--section <section>", `Configuration sections (repeatable). Options: ${CONFIGURE_WIZARD_SECTIONS.join(", ")}`, (value, previous) => [...previous, value], []).action(async (opts) => {
		await runCommandWithRuntime(defaultRuntime, async () => {
			const sections = Array.isArray(opts.section) ? opts.section.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean) : [];
			if (sections.length === 0) {
				await configureCommand(defaultRuntime);
				return;
			}
			const invalid = sections.filter((s) => !CONFIGURE_WIZARD_SECTIONS.includes(s));
			if (invalid.length > 0) {
				defaultRuntime.error(`Invalid --section: ${invalid.join(", ")}. Expected one of: ${CONFIGURE_WIZARD_SECTIONS.join(", ")}.`);
				defaultRuntime.exit(1);
				return;
			}
			await configureCommandWithSections(sections, defaultRuntime);
		});
	});
}

//#endregion
export { registerConfigureCommand };