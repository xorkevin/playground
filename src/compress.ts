import type {Result} from '@xorkevin/nuke/computil';

const base64Chars = /\+|\/|=/g;

export const compress = async (
  data: ArrayBuffer,
): Promise<Result<string, Error>> => {
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const blob = await new Response(stream).blob();

  const u = await new Promise<Result<string, Error>>((resolve) => {
    const fileReader = new FileReader();
    fileReader.onerror = () => {
      resolve({err: fileReader.error ?? new Error('File reader error')});
    };
    fileReader.onload = () => {
      if (typeof fileReader.result !== 'string') {
        resolve({err: new Error('File reader result is not a string')});
        return;
      }
      const idx = fileReader.result.indexOf(',');
      if (idx < 0) {
        resolve({err: new Error('File reader result malformed')});
        return;
      }
      const u = fileReader.result
        .replaceAll(base64Chars, (s) => {
          switch (s) {
            case '+':
              return '-';
            case '/':
              return '_';
            default:
              return '';
          }
        })
        .slice(idx + 1);
      resolve({value: u});
    };
    fileReader.readAsDataURL(blob);
  });
  return u;
};

const base64URLChars = /-|_/g;

export const decompress = async (
  data: string,
): Promise<Result<ArrayBuffer, Error>> => {
  const u = data.replaceAll(base64URLChars, (s) => {
    switch (s) {
      case '-':
        return '+';
      case '_':
        return '/';
      default:
        return '';
    }
  });
  const res = await fetch(`data:application/octet-stream;base64,${u}`);

  const stream =
    res.body?.pipeThrough(new DecompressionStream('gzip')) ??
    new Blob(['']).stream();
  try {
    const u = await new Response(stream).arrayBuffer();
    return {value: u};
  } catch (err) {
    return {err: new Error('Failed decoding data', {cause: err})};
  }
};

const resizeBuf = (
  buf: ArrayBuffer,
  size: number,
  maxSize: number,
): ArrayBuffer => {
  const next = new ArrayBuffer(Math.min(size, maxSize));
  new Uint8Array(next).set(new Uint8Array(buf));
  return next;
};

export const strArrToBuf = (arr: string[]): ArrayBuffer => {
  const allStrSize = arr.reduce((acc, v) => acc + v.length, 0);
  const estimatedSize = allStrSize + arr.length * 4;
  const maxSize = allStrSize * 3 + arr.length * 4;
  let buf = new ArrayBuffer(estimatedSize);
  let offset = 0;
  const textEncoder = new TextEncoder();
  for (let v of arr) {
    let totalWritten = 0;
    while (v.length > 0) {
      const start = offset + totalWritten + 4;
      const end = start + v.length * 3;
      if (end > buf.byteLength) {
        buf = resizeBuf(buf, end, maxSize);
      }
      const view = new Uint8Array(buf, offset + totalWritten + 4);
      const {read, written} = textEncoder.encodeInto(v, view);
      totalWritten += written;
      v = v.slice(read);
    }
    const view = new DataView(buf, offset);
    view.setUint32(0, totalWritten, false);
    offset += totalWritten + 4;
  }
  return buf.slice(0, offset);
};

export const bufToStrArray = (buf: ArrayBuffer): Result<string[], Error> => {
  const arr = [];
  const textDecoder = new TextDecoder();
  let offset = 0;
  while (offset < buf.byteLength) {
    if (offset + 4 > buf.byteLength) {
      return {err: new Error('Malformed buffer string encoding')};
    }
    const view = new DataView(buf, offset);
    const l = view.getUint32(0, false);
    if (offset + l + 4 > buf.byteLength) {
      return {err: new Error('Malformed buffer string encoding')};
    }
    const s = textDecoder.decode(new Uint8Array(buf, offset + 4, l));
    arr.push(s);
    offset += l + 4;
  }
  return {value: arr};
};

export const hexDigestStr = async (s: string): Promise<string> => {
  const textEncoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(s));
  return Array.from(new Uint8Array(digest))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
};
