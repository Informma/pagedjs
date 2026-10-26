// Informma (CER-2976): the edits relayout.spec.js makes, by name, to content as Paged.js holds it: by the spec, to
// chunker.source after a layout; or, for the reference, to the parsed content at afterParsed, from ?edit=<name>.
// Each changes text nodes' data only, in place, and returns the nodes it changed.
(function () {
	const MORE = " This sentence was added to make the section longer than a page.".repeat(24);
	const text = (root, id) => root.querySelector("#" + id).firstChild;
	const append = (root, id, more) => {
		const node = text(root, id);
		node.data = node.data + more;
		return node;
	};
	const set = (root, id, data) => {
		const node = text(root, id);
		node.data = data;
		return node;
	};
	const EDITS = {
		sentence: (root) => [append(root, "p7", " An added sentence.")],
		grow: (root) => [append(root, "p3", MORE)],
		shrink: (root) => [set(root, "p5", "Short now.")],
		two: (root) => [append(root, "p3", " One more."), append(root, "p10", MORE)],
		contents: (root) => [set(root, "toc-s2", "Section 2, retitled at length so that its entry in the contents wraps onto a second line")],
		title: (root) => [set(root, "doc-name", "The Relayout Fixture, Retitled")],
		last: (root) => [append(root, "p12", MORE)],
		table: (root) => [append(root, "intro", " Three lines more, so that every page after the first starts a few rows earlier.".repeat(3))]
	};
	window.RelayoutEdits = EDITS;

	const name = new URLSearchParams(window.location.search).get("edit");
	if (name && window.Paged) {
		class ReferenceEdit extends window.Paged.Handler {
			afterParsed(parsed) {
				EDITS[name](parsed);
			}
		}
		window.Paged.registerHandlers(ReferenceEdit);
	}
})();
