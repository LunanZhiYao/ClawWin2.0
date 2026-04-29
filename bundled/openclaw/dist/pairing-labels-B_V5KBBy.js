import { s as getPairingAdapter } from "./pairing-store-6LVzE5wS.js";

//#region src/pairing/pairing-labels.ts
function resolvePairingIdLabel(channel) {
	return getPairingAdapter(channel)?.idLabel ?? "userId";
}

//#endregion
export { resolvePairingIdLabel as t };