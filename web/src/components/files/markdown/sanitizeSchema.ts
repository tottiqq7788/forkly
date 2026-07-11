import { defaultSchema } from "rehype-sanitize";
import type { Options as Schema } from "rehype-sanitize";

/** Strict allowlist after rehype-raw; KaTeX / highlight run after this on trusted local output. */
export const markdownSanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "kbd",
    "details",
    "summary",
    "mark",
    "sub",
    "sup",
    "section",
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "name", "target", "rel", "ariaDescribedBy", "dataFootnoteRef", "dataFootnoteBackref"],
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    pre: [...(defaultSchema.attributes?.pre ?? []), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
    div: [...(defaultSchema.attributes?.div ?? []), "className"],
    section: [...(defaultSchema.attributes?.section ?? []), "className", "dataFootnotes"],
    h1: [...(defaultSchema.attributes?.h1 ?? []), "id"],
    h2: [...(defaultSchema.attributes?.h2 ?? []), "id"],
    h3: [...(defaultSchema.attributes?.h3 ?? []), "id"],
    h4: [...(defaultSchema.attributes?.h4 ?? []), "id"],
    h5: [...(defaultSchema.attributes?.h5 ?? []), "id"],
    h6: [...(defaultSchema.attributes?.h6 ?? []), "id"],
    li: [...(defaultSchema.attributes?.li ?? []), "id", "className"],
    input: [...(defaultSchema.attributes?.input ?? []), "type", "checked", "disabled"],
    img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "title", "loading", "decoding", "referrerPolicy"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};
