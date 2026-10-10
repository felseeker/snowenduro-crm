exports.handler = async (event, context) => {
  const { handleRequest } = await import("./handler.mjs");
  return handleRequest(event, context);
};
