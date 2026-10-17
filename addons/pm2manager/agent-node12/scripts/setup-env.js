#!/usr/bin/env node

// Creates pm2-agent/.env from .env.example on first install and fills in a random
// AGENT_TOKEN. Kept out of install.bat because generating a secret and rewriting a config
// file through batch string handling is how tokens end up truncated at the first '=' or '%'.
//
// Safe to re-run: an existing .env is never overwritten, and a token that is already set
// is left alone — so an operator can pin their own value and reinstall without losing it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AGENT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(AGENT_ROOT, '.env');
const EXAMPLE_PATH = path.join(AGENT_ROOT, '.env.example');

const generateToken = () => crypto.randomBytes(32).toString('hex');

const readValue = (content, key) => {
    const line = content.split(/\r?\n/).find(l => l.trim().startsWith(`${key}=`));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
};

const setValue = (content, key, value) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) return content.replace(re, `${key}=${value}`);
    return content.replace(/\s*$/, `\n${key}=${value}\n`);
};

let created = false;
let content;

if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf8');
} else if (fs.existsSync(EXAMPLE_PATH)) {
    content = fs.readFileSync(EXAMPLE_PATH, 'utf8');
    created = true;
} else {
    console.error('[setup-env] .env.example not found — cannot create .env.');
    process.exit(1);
}

let token = readValue(content, 'AGENT_TOKEN');
let tokenGenerated = false;
if (!token) {
    token = generateToken();
    content = setValue(content, 'AGENT_TOKEN', token);
    tokenGenerated = true;
}

if (created || tokenGenerated) {
    fs.writeFileSync(ENV_PATH, content);
}

const port = readValue(content, 'PORT') || '7003';
const host = readValue(content, 'HOST') || '0.0.0.0';

console.log(created ? '  .env created from .env.example' : '  .env already exists — kept as is');
console.log(tokenGenerated ? '  AGENT_TOKEN generated' : '  AGENT_TOKEN already set — kept as is');
console.log('');
console.log('  HOST        : ' + host);
console.log('  PORT        : ' + port);
console.log('  AGENT_TOKEN : ' + token);
console.log('');
console.log('  Give this token to pm2-admin when you add this server.');
