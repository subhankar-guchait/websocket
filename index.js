const http = require("http");
const crypto = require("crypto");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.write("Hello World");
});

const rolesEnum = {
  publisher: "publisher",
  subscriber: "subscriber",
};

const WebSocketOperationCodeEnum = {
  FINAL: 0x80, // decimal 128
  CLOSE: 0x8, // decimal 8
  STRING: 0x1, // decimal 1
};

const WebSocketBytesOffset = {
  OPERATION_CODE: 0,
  PAYLOAD_LENGTH: 1,
  MASK_KEY_CLIENT: 2,
  DATA_CLIENT: 6,
};

const BitWiseComparatorAmount = {
  FOUR: 0xf, // decimal 15 - binary 1111
  SEVEN: 0x7f, // decimal 127 - binary 1111111
};

const socketToSubscriberMap = new Map();

const MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

server.on("upgrade", (req, socket) => {
  console.log("upgrade req received");

  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  const url = new URL(req.url, `http://${req.headers.host}`);

  const token = url.searchParams.get("access-token");
  console.log("Received access token:", token);

  console.log("WebSocket upgrade request for path:", pathname);

  let pathArray = pathname.split("/").filter(Boolean);

  const role = pathArray[0];
  const topic = pathArray[1];

  socket.id = randomId();
  socket.topic = topic;

  if (!socketToSubscriberMap.has(topic)) {
    socketToSubscriberMap.set(topic, new Set());
  }

  if (role === "pub") {
    socket.role = rolesEnum.publisher;
  } else if (role === "subs") {
    socket.role = rolesEnum.subscriber;

    socketToSubscriberMap.get(topic).add(socket);
  } else {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

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
    const result = handleClientWebSocketData(buffer);

    console.log(result);

    // CLOSE frame handling
    if (result.type === "close") {
      console.log("Client requested close:", socket.id);

      socket.write(createCloseFrame());

      socket.end();
      socket.destroy();

      if (socket.role === rolesEnum.subscriber) {
        const subs = socketToSubscriberMap.get(socket.topic);
        if (!subs) return;
        subs.delete(socket);
      }
      return;
    }

    if (result.type === "invalid") {
      return;
    }

    const message = result.data;
    if (!message) return;
    console.log("Decoded message:", message);
    if (socket.role === rolesEnum.publisher) {
      const subs = socketToSubscriberMap.get(socket.topic);

      if (!subs) return;

      subs.forEach((sub) => {
        sub.write(encodeWebSocketFrame(message));
      });
    }
  });

  console.log("WebSocket handshake done!");
});

function startWebSocketServer(port) {
  server.listen(port, () => {
    console.log("server started on port::", port);
  });
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

function randomId() {
  return crypto.randomBytes(16).toString("hex");
}

const handleClientWebSocketData = (clientBuffer) => {
  const webSocketClientOperationByte = clientBuffer.readUInt8(
    WebSocketBytesOffset.OPERATION_CODE,
  );

  // & is used to ignore every bit which doesn't correspond to opcode
  // https://www.rfc-editor.org/rfc/rfc6455#section-5.2
  const opCode = webSocketClientOperationByte & BitWiseComparatorAmount.FOUR;

  if (opCode === WebSocketOperationCodeEnum.CLOSE) return { type: "close" }; // This null signify it's a connection termination frame

  if (opCode !== WebSocketOperationCodeEnum.STRING) return { type: "invalid" }; // We just wanna string for now

  const webSocketPayloadLengthByte = clientBuffer.readUInt8(
    WebSocketBytesOffset.PAYLOAD_LENGTH,
  );

  // & is used to ignore every bit which doesn't correspond to payload length
  const framePayloadLength =
    webSocketPayloadLengthByte & BitWiseComparatorAmount.SEVEN;

  const responseBuffer = new Buffer.alloc(
    clientBuffer.length - WebSocketBytesOffset.DATA_CLIENT,
  );

  let frameByteIndex = WebSocketBytesOffset.DATA_CLIENT;

  // This loop is based on doc: https://www.rfc-editor.org/rfc/rfc6455#section-5.3
  for (let i = 0, j = 0; i < framePayloadLength; ++i, j = i % 4) {
    // Browser always mask the frame
    // "The masking key is a 32-bit value chosen at random by the client"
    // https://www.rfc-editor.org/rfc/rfc6455#page-30.
    // https://www.rfc-editor.org/rfc/rfc6455#section-5.3
    const frameMask = clientBuffer[WebSocketBytesOffset.MASK_KEY_CLIENT + j];

    const source = clientBuffer.readUInt8(frameByteIndex); // receive hexadecimal, return decimal

    responseBuffer.writeUInt8(source ^ frameMask, i);

    frameByteIndex++;
  }

  return { type: "message", data: responseBuffer.toString() };
};

function createCloseFrame() {
  const frame = Buffer.alloc(2);
  frame[0] = 0b10001000; // FIN + CLOSE opcode
  frame[1] = 0;
  return frame;
}
