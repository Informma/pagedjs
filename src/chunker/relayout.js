// A re-layout from a changed stretch (Informma, CER-2976 epic-05 sprint-08): the pages between two forced page breaks
// form a stretch, and nothing after a stretch can move a break inside it, so a stretch is where a re-layout starts and
// where it can stop.

const FORCED = ["page", "left", "right", "recto", "verso"];

/**
 * Whether a page whose start token this is starts at a forced break: an element Breaks marked as breaking before it,
 * or after the element before it, with no offset into it.
 * @param {BreakToken} token a page's start token
 * @returns {boolean} whether it does
 */
export function forcedStart(token) {
	let node = token && token.node;
	if (!node || node.nodeType !== 1 || token.offset || !node.dataset) {
		return false;
	}
	return FORCED.includes(node.dataset.breakBefore) || FORCED.includes(node.dataset.previousBreakAfter);
}

/**
 * Nodes in document order.
 * @param {Array<Node>} nodes nodes of one tree
 * @returns {Array<Node>} a sorted copy
 */
export function inDocumentOrder(nodes) {
	return Array.from(nodes).sort((a, b) => {
		if (a === b) {
			return 0;
		}
		return a.compareDocumentPosition(b) & 4 ? -1 : 1; // Node.DOCUMENT_POSITION_FOLLOWING
	});
}

/**
 * How many pages a stretch has: from the first page given to the next that starts at a forced break, or the last.
 * @param {Array<Page>} pages the stretch's first page and those after it
 * @returns {number} its length
 */
export function stretchLength(pages) {
	let n = 1;
	while (n < pages.length && !forcedStart(pages[n].startToken)) {
		n++;
	}
	return n;
}
