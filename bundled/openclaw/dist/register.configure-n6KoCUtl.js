import "./paths-B4BZAPZh.js";
import { V as theme, d as defaultRuntime } from "./subsystem-BbhgPUzd.js";
import "./utils-Bu8JlY-C.js";
import "./pi-embedded-helpers-DLeTj87G.js";
import "./reply-CYMZTXlH.js";
import "./exec-DrOTyHk4.js";
import "./agent-scope-dwzDG1b1.js";
import "./model-selection-ChgnVmWu.js";
import "./github-copilot-token-nncItI8D.js";
import "./boolean-BgXe2hyu.js";
import "./env-Cw8GAYpM.js";
import "./config-DTbrEHqs.js";
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
import "./onboard-helpers-DsWG_ruh.js";
import "./prompt-style-_k1DA6Wp.js";
import "./pairing-labels-DRgmeoqx.js";
import "./session-cost-usage-r-Rovr3R.js";
import "./nodes-screen-BiNBeuxJ.js";
import "./control-service-duwKSJek.js";
import "./channel-selection-Ct5caPKx.js";
import "./delivery-queue-CJGN_Wrf.js";
import "./catalog-KgzGgAlY.js";
import "./skills-status-CZbSlnxZ.js";
import "./note-D6P6WGO6.js";
import "./clack-prompter-CDRNEIEq.js";
import "./plugin-auto-enable-C3SNAQsT.js";
import "./onboard-channels-DqtbGncN.js";
import "./npm-registry-spec-CguX2-wR.js";
import "./skill-scanner-MgCRxbOf.js";
import "./installs-cu_vs3GK.js";
import "./daemon-runtime-BypEai8I.js";
import "./service-BmdpdrKO.js";
import "./systemd-CfWFfqz_.js";
import "./widearea-dns-_z0-cE6J.js";
import "./onboard-skills-EO5vGuAg.js";
import "./health-v46l7iF9.js";
import "./health-format-Kwo85CEL.js";
import "./auth-choice-B9qgRdsf.js";
import "./github-copilot-auth-BiaSo_ZY.js";
import "./logging-DgGsK4TF.js";
import "./systemd-linger-Cv43CYua.js";
import { CONFIGURE_WIZARD_SECTIONS, configureCommand, configureCommandWithSections } from "./configure-C5NruDsC.js";

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