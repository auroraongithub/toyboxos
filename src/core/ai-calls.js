/* Tool calls contain opaque provider state (e.g. Gemini thought signatures).
   Keep every parsed field when assigning defaults before saving chat history. */
export function storedCalls(calls, newId) {
  return calls.map((call, i) => ({ ...call, id: call.id || "call_" + newId() + i, a: call.a || "{}" }));
}
export const toolFailed = result =>
  result?.ok === false || /^(Failed:|Those arguments weren't valid JSON)/.test(result?.t || "");
