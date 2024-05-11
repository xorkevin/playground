declare module '*.wasm' {
  const url: string;
  export default url;
}

declare module '*/wasm' {
  const url: string;
  export default url;
}
