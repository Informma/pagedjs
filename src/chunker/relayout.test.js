import { forcedStart, stretchLength } from "./relayout.js";
import { pageRulesRefusal } from "../modules/paged-media/atpage.js";
import { rebuildAncestors, restoreRow } from "../utils/dom.js";

/**
 * An element with the data attributes Breaks writes.
 * @param {object} data dataset entries
 * @returns {Element} the element
 */
function element(data) {
	let el = document.createElement("section");
	Object.assign(el.dataset, data);
	return el;
}

describe("relayout", () => {

	it("TL27: knows a page that starts at a forced break by its start token", () => {
		expect(forcedStart({ node: element({ breakBefore: "page" }) })).toBe(true);
		expect(forcedStart({ node: element({ previousBreakAfter: "right" }) })).toBe(true);
		expect(forcedStart({ node: element({ breakBefore: "recto" }), offset: 0 })).toBe(true);
		expect(forcedStart({ node: element({ breakBefore: "page" }), offset: 3 })).toBe(false);
		expect(forcedStart({ node: element({ breakBefore: "avoid" }) })).toBe(false);
		expect(forcedStart({ node: element({}) })).toBe(false);
		expect(forcedStart({ node: document.createTextNode("x") })).toBe(false);
		expect(forcedStart(undefined)).toBe(false);
	});

	it("TL27: counts a stretch from its first page to the next forced start", () => {
		const page = (forced) => ({ startToken: { node: element(forced ? { breakBefore: "page" } : {}) } });
		expect(stretchLength([page(true), page(false), page(false), page(true)])).toBe(3);
		expect(stretchLength([page(true), page(true)])).toBe(1);
		expect(stretchLength([page(false), page(false)])).toBe(2);
		expect(stretchLength([page(true)])).toBe(1);
	});

	it("TL27: refuses page rules a page's side or name would change", () => {
		expect(pageRulesRefusal({ "*": {}, ":first": { psuedo: "first" } })).toBeUndefined();
		expect(pageRulesRefusal({ ":left": { psuedo: "left" } })).toBe("side-pages");
		expect(pageRulesRefusal({ ":right": { psuedo: "right" } })).toBe("side-pages");
		expect(pageRulesRefusal({ ":blank": { psuedo: "blank" } })).toBe("side-pages");
		expect(pageRulesRefusal({ ":nth(2)": { nth: "2" } })).toBe("nth-pages");
		expect(pageRulesRefusal({ "wide": { name: "wide" } })).toBe("named-pages");
	});

	it("TL30: puts back a row whose cells Paged.js rebuilt in the source, once", () => {
		const table = document.createElement("table");
		table.innerHTML = "<tbody><tr><th>Item</th><td>Code</td><td>Size</td></tr>"
			+ "<tr><th>Label:</th> <td colspan=\"2\">Value</td></tr><tr><th>Other:</th> <td colspan=\"2\">x</td></tr></tbody>";
		const [, row, other] = table.querySelectorAll("tr");
		const before = Array.from(row.childNodes);
		rebuildAncestors(row);
		expect(row.childNodes.length).toBe(2);
		expect(restoreRow(row)).toBe(true);
		expect(Array.from(row.childNodes)).toEqual(before);
		expect(restoreRow(row)).toBe(false);
		expect(restoreRow(other)).toBe(false);
		expect(other.childNodes.length).toBe(3);
		expect(restoreRow(undefined)).toBe(false);
	});
});
