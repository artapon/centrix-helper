let crypto = require('crypto'),
    algorithm = 'aes-256-ctr',
    password = 'bmw320d';

let CryptoJS = require("crypto-js");
let medintpassword = "medint";

exports.centrixEncrypt = function(text) {
    var cipher = crypto.createCipher(algorithm, password)
    var crypted = cipher.update(text, 'utf8', 'hex')
    crypted += cipher.final('hex');
    return crypted;
};

exports.centrixDecrypt = function(text) {
    var decipher = crypto.createDecipher(algorithm, password)
    var dec = decipher.update(text, 'hex', 'utf8')
    dec += decipher.final('utf8');
    return dec;
};

exports.medintEncrypt = function(text) {
    return CryptoJS.AES.encrypt(text, medintpassword).toString();
};
  
exports.medintDecrypt = function(text) {
    let decrypted = CryptoJS.AES.decrypt(text, medintpassword);
    return decrypted.toString(CryptoJS.enc.Utf8);
};

