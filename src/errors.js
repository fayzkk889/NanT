export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export class SourceNeeded extends Error {
  constructor(message) { super(message); this.name = 'SourceNeeded'; }
}
export function assert(condition, message) {
  if (!condition) throw new InputError(message);
}
