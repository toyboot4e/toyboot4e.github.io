import { expect, test } from "vitest";
import { isCard } from "../src/bake-util.ts";
import { isCoderefs } from "../src/highlight.ts";
import { parseJson, recordOf } from "../src/guard.ts";

test("guards accept the shapes the build writes", () => {
  const cache = parseJson('{"https://a":{"title":"A","kind":"card"}}', recordOf(isCard), "cache");
  expect(cache["https://a"]?.title).toBe("A");
  expect(isCoderefs([{ line: 0, label: "a", start: 1, end: 2 }])).toBe(true);
});

test.each([
  ["wrong field type", '{"https://a":{"title":1}}'],
  ["unknown kind", '{"https://a":{"kind":"video"}}'],
  ["not an object", '["https://a"]'],
])("guards reject %s", (_name, json) => {
  expect(() => parseJson(json, recordOf(isCard), "cache")).toThrow("cache: unexpected JSON shape");
});
