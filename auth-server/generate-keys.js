const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const certDir = path.resolve("cert");
const privateKey = path.join(certDir, "private-key.pem");
const publicKey = path.join(certDir, "public-key.pub");

if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

if (!fs.existsSync(privateKey)) {
  console.log("Generating RSA keys...");
  execSync(`openssl genrsa -out ${privateKey} 2048`);
  execSync(`openssl rsa -in ${privateKey} -pubout -out ${publicKey}`);
  console.log("RSA keys generated.");
} else {
  console.log("RSA keys already exist.");
}
