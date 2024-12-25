export class Error401 extends Error {
  status = 401;
  publicMessage: string | undefined;
}
export class Error404 extends Error {
  status = 404;
  publicMessage: string | undefined;
}
