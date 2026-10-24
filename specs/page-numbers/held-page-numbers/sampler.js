/* global Paged */
// Informma (CER-2976): after every page is laid out and finalized, samples every page's computed counter-increment
// and every margin box's generated content, with the browser's own getComputedStyle (TL6, TL8), and counts the
// margin groups already sized (TL13). Only reads: it
// changes nothing Paged.js lays out.
window.__samples = {increments: {}, contents: {}, sized: 0};
class HeldPageNumbersSampler extends Paged.Handler {
	sample() {
		var gcs = window.__getComputedStyle;
		var samples = window.__samples;
		document.querySelectorAll(".pagedjs_page").forEach(function (page) {
			var increment = gcs(page)["counter-increment"];
			samples.increments[increment] = (samples.increments[increment] || 0) + 1;
		});
		samples.sized += document.querySelectorAll(".pagedjs_margin-top[style*='grid-template-columns'], " +
			".pagedjs_margin-bottom[style*='grid-template-columns'], .pagedjs_margin-left[style*='grid-template-rows'], " +
			".pagedjs_margin-right[style*='grid-template-rows']").length;
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
