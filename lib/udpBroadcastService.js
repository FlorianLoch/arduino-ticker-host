const dgram = require("dgram");

const encoder = require("./encoder");

const BUF_REQUEST = Buffer.from("request");

class UDPBroadcastService {
  constructor(port, encryptionKey) {
    this.port = port;
    this.encryptionKey = encryptionKey;
    this.lastMessageBroadcasted;

    this.server = dgram.createSocket("udp4");

    this.server.on("error", (err) => {
      console.error(`Error caused by UDP server:\n${err.stack}`);
      this.server.close();
    });

    this.server.on("message", (msg, rinfo) => {
      if (
        !msg.equals(BUF_REQUEST) ||
        this.lastMessageBroadcasted === undefined
      ) {
        return;
      }

      console.log(
        `=> Received datagram requesting current track information from ${rinfo.address}:${rinfo.port}`
      );

      // TODO do not broadcast information, send to this client only
      this.broadcast(this.lastMessageBroadcasted);
    });
  }

  start(iface) {
    // TODO use promisify
    return new Promise((resolve, _) => {
      this.server.bind(this.port, iface, () => {
        this.server.setBroadcast(true);
        resolve();
      });
    });
  }

  broadcast(message) {
    this.lastMessageBroadcasted = message;

    const encoded = encoder.encodeMessage(message, this.encryptionKey);

    this.server.send(encoded, this.port, "255.255.255.255");
  }
}

module.exports = UDPBroadcastService;
