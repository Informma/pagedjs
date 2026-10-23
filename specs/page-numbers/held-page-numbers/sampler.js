/* global Paged */
// Informma (CER-2976): after every page is laid out and finalized, samples every page's computed counter-increment
// and every margin box's generated content, with the browser's own getComputedStyle (TL6, TL8). Only reads: it
// changes nothing Paged.js lays out.
window.__samples = {increments: {}, contents: {}};
class HeldPageNumbersSampler extends Paged.Handler {
	sample() {
		var gcs = window.__getComputedStyle;
		var samples = window.__samples;
		document.querySelectorAll(".pagedjs_page").forEach(function (page) {
			var increment = gcs(page)["counter-increment"];
			samples.increments[increment] = (samples.increments[increment] || 0) + 1;
		});
		document.querySelectorAll(".pagedjs_margin-content").forEach(function (box) {
			var content = gcs(box, "::after").content;
			var kind = content.indexOf("counter(") >= 0 ? "counter" : "other";
			samples.contents[kind] = (samples.contents[kind] || 0) + 1;
		});
	}
	afterPageLayout() {
		this.sample();
	}
	finalizePage() {
		this.sample();
	}
}
Paged.registerHandlers(HeldPageNumbersSampler);
