export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.statusCode = status;
  }
}
