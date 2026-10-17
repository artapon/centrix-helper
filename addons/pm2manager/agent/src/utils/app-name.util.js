// One definition of what a PM2 process identifier may look like. Every layer that accepts
// an app name from a request (routes, controllers, PM2 provider) validates through here,
// so they cannot drift apart on what a valid name is.
const APP_NAME_RE = /^[A-Za-z0-9_.,:\-]{1,128}$/;

const isValidAppName = (n) => typeof n === 'string' && APP_NAME_RE.test(n);

module.exports = {
    APP_NAME_RE,
    isValidAppName
};
