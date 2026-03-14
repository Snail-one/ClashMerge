const { runTransformInProcess } = require("./transform-runtime");

process.on("message", async message => {
  if (!message || message.type !== "run-transform") {
    return;
  }

  try {
    const output = await runTransformInProcess(message.scriptContent, message.config, message.context);
    process.send({ ok: true, output });
  } catch (error) {
    process.send({ ok: false, error: error.message });
  } finally {
    process.disconnect?.();
  }
});
