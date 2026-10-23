import { heldContent, holdPlan } from "./held-page-counters.js";

/**
 * A rule as the plan reads one from the CSSOM: its selector, and its declarations by property.
 * @param {string} selectorText the rule's selector
 * @param {object} declarations its declarations' values, by property
 * @returns {object} a rule with selectorText and a style that answers getPropertyValue
 */
function rule(selectorText, declarations) {
	return {
		selectorText,
		style: {
			getPropertyValue: (property) => declarations[property] || ""
		}
	};
}

const PAGE = rule(".pagedjs_page", {
	"counter-increment": "page var(--pagedjs-page-counter-increment)",
	"width": "var(--pagedjs-width)"
});
const PAGES = rule(".pagedjs_pages", {
	"counter-reset": "page 0 pages var(--pagedjs-page-count) footnote var(--pagedjs-footnotes-count)"
});
const ROOT = rule(":root", {"--pagedjs-page-counter-increment": "1"});
const BOTTOM_RIGHT = rule(".pagedjs_page .pagedjs_margin-bottom-right > .pagedjs_margin-content::after", {
	"content": "\"Page \" counter(page) \" of \" counter(pages)"
});
const FIRST_BOTTOM_RIGHT = rule(".pagedjs_page.pagedjs_first_page .pagedjs_margin-bottom-right > .pagedjs_margin-content::after", {
	"content": "\"\""
});
const FOOTNOTE = rule("[data-footnote-call]::after", {"content": "counter(footnote)"});
const CATALOGUE = [ROOT, PAGE, PAGES, FOOTNOTE, BOTTOM_RIGHT, FIRST_BOTTOM_RIGHT];

describe("HeldPageCounters", () => {

	it("TH1: holds a margin box's page numbers as text, keeping everything else in its value", () => {
		expect(heldContent("\"Page \" counter(page) \" of \" counter(pages)"))
			.toEqual({value: "\"Page \" var(--pagedjs-held-page) \" of \" \"0\"", changed: true});
		expect(heldContent("counter(page, decimal)")).toEqual({value: "var(--pagedjs-held-page)", changed: true});
		expect(heldContent("var(--pagedjs-string-first-title) \" \" counter(page)"))
			.toEqual({value: "var(--pagedjs-string-first-title) \" \" var(--pagedjs-held-page)", changed: true});
		expect(heldContent("\"see counter(page) here\""))
			.toEqual({value: "\"see counter(page) here\"", changed: false});
		expect(heldContent("'it\\'s' counter( page )")).toEqual({value: "'it\\'s' var(--pagedjs-held-page)", changed: true});
	});

	it("TH2: refuses a value it can't hold exactly", () => {
		for (const value of ["counter(page, upper-roman)", "counters(page, \".\")", "counter(chapter)",
			"target-counter(attr(href), page)", "\"Page \" counter(page", "\"unclosed", "var(--x, counter(page))"]) {
			expect(heldContent(value)).toBeNull();
		}
	});

	it("TH3: holds the pages' increment and the margin boxes that name a page counter, and nothing else", () => {
		const plan = holdPlan(CATALOGUE, false);
		expect(plan.map(([r, property, value]) => [r.selectorText, property, value])).toEqual([
			[".pagedjs_page", "counter-increment", "none"],
			[BOTTOM_RIGHT.selectorText, "content", "\"Page \" var(--pagedjs-held-page) \" of \" \"0\""]
		]);
		expect(plan[0][0]).toBe(PAGE);
	});

	it("TH6: reads only the properties a rule declares, as Chrome 152 answers \"unset\" for any custom property of an all: unset rule", () => {
		// Paged.js's own .pagedjs_area [data-footnote-call] { all: unset; ... }: declares no custom property, but its
		// getPropertyValue("--pagedjs-page-counter-increment") is "unset" in Chrome 152 (and "" in Playwright's 112)
		const allUnset = {
			selectorText: ".pagedjs_area [data-footnote-call]",
			style: Object.assign(["color", "font"], {getPropertyValue: () => "unset"})
		};
		expect(holdPlan([...CATALOGUE, allUnset], false)).not.toBeNull();
	});

	it("TH7: qualifies a document whose rules the in-page host has scoped to its container", () => {
		// In a shadow root, the host gives :root's rules to the catalogue's container, Paged.js's default increment
		// among them; on a plain element it also prefixes every other selector with the container's
		const scoped = (r, selectorText) => ({selectorText, style: r.style});
		const shadow = [scoped(ROOT, ".catalogue-in-page"), PAGE, PAGES, FOOTNOTE, BOTTOM_RIGHT, FIRST_BOTTOM_RIGHT];
		expect(holdPlan(shadow, false).map(([r, property]) => [r.selectorText, property]))
			.toEqual([[".pagedjs_page", "counter-increment"], [BOTTOM_RIGHT.selectorText, "content"]]);
		const plain = [scoped(ROOT, ".catalogue-in-page"), scoped(PAGE, ".catalogue-in-page .pagedjs_page"),
			scoped(PAGES, ".catalogue-in-page .pagedjs_pages"), FOOTNOTE,
			scoped(BOTTOM_RIGHT, ".catalogue-in-page " + BOTTOM_RIGHT.selectorText), FIRST_BOTTOM_RIGHT];
		expect(holdPlan(plain, false)).not.toBeNull();
		expect(holdPlan([...shadow, rule(".catalogue-in-page section", {"--pagedjs-page-counter-increment": "2"})], false))
			.toBeNull();
	});

	it("TH4: refuses a document whose page numbering isn't the simple case", () => {
		const refused = {
			"a page counter outside a margin box": [...CATALOGUE, rule(".see::after", {"content": "counter(page)"})],
			"a page reset outside Paged.js's own": [...CATALOGUE, rule("h1.chapter", {"counter-reset": "page 5"})],
			"a page counter set": [...CATALOGUE, rule("h1.chapter", {"counter-set": "page 1"})],
			"a page increment outside Paged.js's own": [...CATALOGUE, rule("section", {"counter-increment": "page 2"})],
			"a page increment from PageCounterIncrement": [...CATALOGUE,
				rule(".pagedjs_page", {"--pagedjs-page-counter-increment": "2"})],
			"a counter style in a margin box": [...CATALOGUE, rule(".pagedjs_page .pagedjs_margin-top-center > .pagedjs_margin-content::after",
				{"content": "counter(page, upper-roman)"})],
			"no increment of the pages to hold": CATALOGUE.filter((r) => r !== PAGE)
		};
		for (const [name, rules] of Object.entries(refused)) {
			expect([name, holdPlan(rules, false)]).toEqual([name, null]);
		}
		expect(holdPlan(CATALOGUE, true)).toBeNull();
	});

	it("TH5: holds the pages' increment alone when no margin box names a page counter", () => {
		const plan = holdPlan([ROOT, PAGE, PAGES, FOOTNOTE, FIRST_BOTTOM_RIGHT], false);
		expect(plan.map(([r, property, value]) => [r.selectorText, property, value]))
			.toEqual([[".pagedjs_page", "counter-increment", "none"]]);
	});

});
