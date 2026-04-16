const http = require("http");
const crypto = require("crypto");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.write("Hello World");
});

const MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

server.on("upgrade", (req, socket) => {
  console.log("upgrade req received");
  const clientWsKey = req.headers["sec-websocket-key"];
  const hash = crypto
    .createHash("sha1")
    .update(clientWsKey + MAGIC_STRING)
    .digest("base64");
  const responseHeaders = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${hash}`,
    "\r\n",
  ];

  socket.write(responseHeaders.join("\r\n"));

  socket.on("data", (buffer) => {
    console.log("Received data from client:", buffer);
    const message = decodeFrame(buffer);
    console.log("Decoded message:", message);
    socket.write(encodeWebSocketFrame("Server got: " + message));
  });
  console.log("WebSocket handshake done!");
});

server.listen(3000, () => {
  console.log("server started on port:: 3000");
});

function decodeFrame(data) {
  // 1. Parse Length
  let byte1 = data[1];
  let payloadLen = byte1 & 127;
  let offset = 2;

  if (payloadLen === 126) {
    // Read next 2 bytes as 16-bit unsigned integer
    payloadLen = (data[2] << 8) | data[3];
    offset = 4;
  } else if (payloadLen === 127) {
    // Read next 8 bytes as a 64-bit integer
    payloadLen = 0;
    for (let i = 0; i < 8; i++) {
      payloadLen = payloadLen * 256 + data[2 + i];
    }
    offset = 10;
  }

  // 2. Identify Masking Key (4 bytes)
  const maskKey = data.slice(offset, offset + 4);
  offset += 4;

  // 3. Extract and Unmask Payload
  const encodedPayload = data.slice(offset, offset + payloadLen);
  const decoded = new Uint8Array(encodedPayload.length);

  for (let i = 0; i < encodedPayload.length; i++) {
    // XOR operation with the 4-byte key (i % 4)
    decoded[i] = encodedPayload[i] ^ maskKey[i % 4];
  }

  // 4. Convert byte array to UTF-8 string
  return new TextDecoder().decode(decoded);
}

function encodeWebSocketFrame(message) {
  const payload = Buffer.from(message);
  const payloadLength = payload.length;

  let frame;

  if (payloadLength < 126) {
    frame = Buffer.alloc(2 + payloadLength);
    frame[0] = 0b10000001; // FIN + text frame
    frame[1] = payloadLength; // server frames are NOT masked
    payload.copy(frame, 2);
  } else {
    throw new Error("Payload too large for this demo");
  }

  return frame;
}
