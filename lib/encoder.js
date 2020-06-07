const crypto = require("crypto");

function _createBlockFromMessage(pojso) {
  let strRepr = Object.keys(pojso).reduce((prev, cur) => {
    return prev + escapeStr(pojso[cur]) + "\n";
  }, "");

  const payload = Buffer.from(strRepr, "utf8");

  // We need our block to have a size which is a multiple of 16 (128 bit, as used by AES128)
  const totalLength = calcPadding(payload.length, 16);
  return Buffer.concat([payload], totalLength);

  function escapeStr(str) {
    str = str.replace(/\\/g, "\\\\"); // replace \ with \\
    return str.replace(/\n/g, "\\n");
  }

  function calcPadding(actualLength, multipleOf) {
    const padLength = multipleOf - (actualLength % multipleOf);
    return actualLength + padLength;
  }
}

/*
    Probably it is a good idea to enforce the key to be an ascii encoded string because? Arduino
    libs might struggle otherwise. For all characters in ASCII (not Extended-ASCII) UTF8 encoded buffer
    should be the same.
*/
function _addHMAC(block, key) {
  // Maybe we should use MD5? It's broken, but it's way faster to compute
  const hasher = crypto.createHash("md5");
  hasher.update(Buffer.concat([block, Buffer(key, "ascii")]));

  const hmac = hasher.digest();

  return Buffer.concat([block, hmac]);
}

function encodeMessage(pojso, key, encrypt = true) {
  let block = _createBlockFromMessage(pojso);
  block = _addHMAC(block, key);

  if (!encrypt) {
    return block;
  }

  // fit key to 128 Bit via MD5
  const hashedKey = crypto
    .createHash("md5")
    .update(Buffer(key, "ascii"))
    .digest();
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv("aes-128-cbc", hashedKey, iv);

  const encrypted = Buffer.concat([iv, cipher.update(block)]);

  return encrypted;
}

module.exports = {
  encodeMessage,
  _createBlockFromMessage,
  _addHMAC,
};
