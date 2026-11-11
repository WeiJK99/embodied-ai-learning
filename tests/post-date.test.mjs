import assert from "node:assert/strict";
import test from "node:test";
import { comparePostsByDate, getBlogDate } from "../src/utils/post-date.ts";

test("a newly written note about an older paper sorts before older blog posts", () => {
	const note = {
		slug: "act",
		data: {
			published: new Date("2023-04-23"),
			created: new Date("2026-11-11"),
		},
	};
	const old = { slug: "old", data: { published: new Date("2026-11-04") } };
	assert.deepEqual([old, note].sort(comparePostsByDate), [note, old]);
	assert.equal(
		getBlogDate(note.data).toISOString(),
		"2026-11-11T00:00:00.000Z",
	);
	assert.equal(note.data.published.toISOString(), "2023-04-23T00:00:00.000Z");
});

test("legacy posts use published; updated does not move posts", () => {
	const data = {
		published: new Date("2026-11-04"),
		updated: new Date("2026-12-01"),
	};
	assert.equal(getBlogDate(data), data.published);
});

test("creation dates determine order even when paper dates run in the opposite direction", () => {
	const earlierNote = {
		slug: "openvla",
		data: {
			published: new Date("2024-06-13"),
			created: new Date("2026-11-10"),
		},
	};
	const laterNote = {
		slug: "act",
		data: {
			published: new Date("2023-04-23"),
			created: new Date("2026-11-11"),
		},
	};
	assert.deepEqual([earlierNote, laterNote].sort(comparePostsByDate), [
		laterNote,
		earlierNote,
	]);
});

test("equal blog dates have a stable slug order and compare equal to themselves", () => {
	const data = { published: new Date("2026-11-11") };
	const a = { slug: "a", data };
	const b = { slug: "b", data };
	assert.deepEqual([b, a].sort(comparePostsByDate), [a, b]);
	assert.equal(comparePostsByDate(a, a), 0);
});
