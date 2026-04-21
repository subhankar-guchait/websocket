const wsUri: string = "ws://localhost:4000/subs/emr";
const websocket = new WebSocket(wsUri);

websocket.onopen = function (event) {
  console.log("WebSocket connection established");
  websocket.send("Hello server!");
};

websocket.onmessage = function (event) {
  console.log("Message from server ", event.data);
};

websocket.onclose = function (event) {
  console.log("WebSocket connection closed");
};

export default function BlogPage() {
  return <h1>Hello from blog</h1>;
}
