require('dotenv').config()
require('./menu.config');
require('./link.config');
const bodyParser = require('body-parser')
const express = require('express')
const fs = require('fs')
const https = require('https')
const http = require('http')
const morgan = require('morgan')
const compression = require('compression')
const httpmode = process.env.APP_HTTP_MODE
const port = process.env.APP_PORT || 3000
const path = require('path')
const rfs = require('rotating-file-stream')
const logDirectory = path.join(__dirname, 'logs')
const MORGAN_TYPE = process.env.MORGAN_TYPE || 'combined'
const json2xls = require('json2xls')
const es6Renderer = require('express-es6-template-engine')
const sessions = require('express-session');
const MemoryStore = require('memorystore')(sessions);
const { ensureSchema } = require('./app/core/migrations/sqlite/migrate');
const modules = require('./app/core/modules');
const renderPage = require('./app/core/middleware/renderPage');
const requireDbConnection = require('./app/core/middleware/requireDbConnection');
const requireAuth = require('./app/core/middleware/requireAuth');
const auth = require('./app/core/auth');
const addons = require('./app/core/addons');
const requireActiveAddon = require('./app/core/middleware/requireActiveAddon');
const legacyRedirect = require('./app/core/middleware/legacyRedirect');

const schemaReady = ensureSchema();
addons.init(schemaReady);
auth.init(schemaReady).catch(function (err) {
  console.error('Failed to initialize sqlite schema:', err.message);
});
global.sessionData = {};
global.sessionData.site_name = "";

//init express
const app = express();

//http or https mode
if (httpmode == 'HTTP') {
  http
  .createServer(app)
  .listen(port, function () {
    process.env.NODE_ENV != 'production'
      ? console.log('app running http on port : ' + port)
      : ''
  })
} else {
  https
    .createServer(
      {
        key: fs.readFileSync('cert.key'),
        cert: fs.readFileSync('cert.crt')
      },
      app
    )
    .listen(port, function () {
      process.env.NODE_ENV != 'production'
        ? console.log('app running https on port : ' + port)
        : ''
    })
}

if (process.env.WRITE_LOG) {
  // ensure log directory exists
  fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory)

  // create a rotating write stream
  let accessLogStream = rfs.createStream('access.log', {
    path: logDirectory
  })

  // setup the logger
  app.use(
    morgan(MORGAN_TYPE, {
      stream: accessLogStream,
      skip: function (req, res) {
        return res.statusCode < 400
      }
    })
  )
} 

app.engine('html', es6Renderer);
app.set('views', path.join(__dirname, 'app', 'core', 'views'));
app.set('view engine', 'html');

// gzip responses: pages embed their table data as JSON
app.use(compression());

// Static files before the parsers and session. /css and /js are referenced with ?v=<content
// hash> (app/core/assets.js) so they can be cached long; vendor files under /lib for a day.
app.use('/lib', express.static(__dirname + '/node_modules/', { maxAge: '1d' }));
app.use('/js', express.static(path.join(__dirname, 'public', 'js'), { maxAge: '30d' }));
app.use('/css', express.static(path.join(__dirname, 'public', 'css'), { maxAge: '30d' }));

//Routers
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
}));
app.use(json2xls.middleware);
app.use(morgan('request: :method :url :status HTTP/:http-version response: :response-time ms'));
app.use(sessions({
    secret: auth.sessionSecret(),
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',             // blocks cross-site form posts carrying the session
      secure: httpmode != 'HTTP',
      maxAge: 8 * 60 * 60 * 1000   // signed out after 8 hours without activity
    },
    resave: false,
    store: new MemoryStore({
      checkPeriod: 86400000 // prune expired entries every 24h
    }),
}));
app.use(renderPage);

app.use((err, req, res, next) => {
  if (res.headersSent) {
    console.error(`Headers already sent for ${req.path}`);
    return;
  }
  next();
});

// HMVC modules: routes.open.js (no sign-in), then routes.public.js behind the sign-in
// guard, then routes.js behind the DB guard as well.
app.use(legacyRedirect);   // old /data, /tool, /settings URLs -> domain URLs (core/routeMap.js)
modules.mountRoutes(app, 'routes.open.js');
app.use(requireAuth);
app.use(requireActiveAddon);   // pages of a deactivated add-on (Marketplace)
modules.mountRoutes(app, 'routes.public.js');
app.use(requireDbConnection);
modules.mountRoutes(app, 'routes.js');

// Errors from any route: logged in full, shown to the user as a page (or JSON for API calls).
// Errors marked expose (e.g. no organisation for the site code) show their own message.
const errorView = require('./app/core/view')('').shared('error');
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  const message = err.expose ? err.message : 'Something went wrong while loading this page. The details are in the server log.';
  if (req.xhr || req.path.startsWith('/api/') || /json/i.test(req.get('accept') || '')) {
    return res.status(status).json({ error: message });
  }
  return res.status(status).renderPage(errorView, {
    title: status === 409 ? 'Site setup problem' : 'Error',
    heading: status === 409 ? 'This connection is not set up correctly' : 'Unable to load this page',
    message,
    showConnections: status === 409
  });
});
