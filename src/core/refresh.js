const { loadSourceContent } = require("./fetch");
const { markSourceRefresh, markSourceUpdated } = require("./sources");

async function refreshSource(source) {
  try {
    const content = await loadSourceContent(source);
    await markSourceRefresh(source.id, {
      lastRefreshStatus: "success",
      lastRefreshError: null,
      lastContentBytes: Buffer.byteLength(content, "utf8"),
    });
    await markSourceUpdated(source.id);
    return { ok: true, content };
  } catch (error) {
    await markSourceRefresh(source.id, {
      lastRefreshStatus: "error",
      lastRefreshError: error.message,
      lastContentBytes: 0,
      lastBuildIncluded: false,
    });
    return { ok: false, error };
  }
}

module.exports = {
  refreshSource,
};
