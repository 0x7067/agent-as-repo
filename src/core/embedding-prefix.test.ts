import { describe, it, expect } from "vitest";
import { embeddingTaskPrefixes } from "./embedding-prefix.js";

describe("embeddingTaskPrefixes", () => {
  it("returns nomic task prefixes for the default http model id", () => {
    expect(embeddingTaskPrefixes("nomic-embed-text")).toEqual({
      document: "search_document: ",
      query: "search_query: ",
    });
  });

  it("returns nomic task prefixes for the default transformersjs model id", () => {
    expect(embeddingTaskPrefixes("nomic-ai/nomic-embed-text-v1.5")).toEqual({
      document: "search_document: ",
      query: "search_query: ",
    });
  });

  it("matches nomic-embed case-insensitively", () => {
    expect(embeddingTaskPrefixes("Nomic-Embed-Text")).toEqual({
      document: "search_document: ",
      query: "search_query: ",
    });
  });

  it("returns empty prefixes for non-nomic OpenAI models", () => {
    expect(embeddingTaskPrefixes("text-embedding-3-small")).toEqual({
      document: "",
      query: "",
    });
  });

  it("returns empty prefixes for other local embedding models", () => {
    expect(embeddingTaskPrefixes("mxbai-embed-large")).toEqual({
      document: "",
      query: "",
    });
  });

  it("returns empty prefixes for an empty model id", () => {
    expect(embeddingTaskPrefixes("")).toEqual({ document: "", query: "" });
  });
});
