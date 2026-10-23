// Informma (CER-2976): counts the calls TL5, TL9 and TL10 assert on. In these documents only Paged.js makes them
// (searched: src/). The browser's own getComputedStyle is kept for the sampler, so its reads aren't counted.
//   pageStyles: a computed style read of a .pagedjs_page, as the number of pages at the time (TL5);
//   areaRects: the content area's getBoundingClientRect by the function that called it, from the stack (TL9);
//   imageStyles: a computed style read of an img outside its load or error event (TL10).
window.__counts = {pageStyles: [], areaRects: {}, imageStyles: 0};
(function () {
	var getComputedStyle = window.getComputedStyle;
	window.__getComputedStyle = getComputedStyle;
	window.getComputedStyle = function (element) {
		if (element && element.classList && element.classList.contains("pagedjs_page")) {
			window.__counts.pageStyles.push(document.querySelectorAll(".pagedjs_page").length);
		}
		if (element && element.tagName === "IMG") {
			var event = window.event;
			if (!event || (event.type !== "load" && event.type !== "error")) {
				window.__counts.imageStyles++;
			}
		}
		return getComputedStyle.apply(this, arguments);
	};
	var getBoundingClientRect = Element.prototype.getBoundingClientRect;
	Element.prototype.getBoundingClientRect = function () {
		if (this.classList && this.classList.contains("pagedjs_page_content")) {
			var caller = (new Error().stack.split("\n")[2] || "").trim().replace(/^at /, "").replace(/ \(.*\)$/, "");
			window.__counts.areaRects[caller] = (window.__counts.areaRects[caller] || 0) + 1;
		}
		return getBoundingClientRect.apply(this, arguments);
	};
})();
