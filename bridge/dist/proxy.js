"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const buffer_1 = require("buffer");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env['PORT'] || '8080';
const BASE_URL = process.env['BASE_URL'] || `http://localhost:${PORT}`;
const BASE_URL_HEADER = process.env['BASE_URL_HEADER'] || 'x-base-url';
const PROXY_API_KEY = process.env['PROXY_API_KEY'] || '';
const REQUIRED_GROUPS = process.env['REQUIRED_GROUPS']?.split(',') || [];
const downstreams = JSON.parse(fs_1.default.readFileSync('downstreams.json', 'utf-8')).servers;
// Logging
const logDirectory = path_1.default.join(__dirname, 'logs');
fs_1.default.existsSync(logDirectory) || fs_1.default.mkdirSync(logDirectory);
const accessLogStream = fs_1.default.createWriteStream(path_1.default.join(logDirectory, 'access.log'), { flags: 'a' });
app.use((0, morgan_1.default)('combined', { stream: accessLogStream }));
// User extraction from ACA headers
function extractUser(req) {
    const encoded = req.headers['x-ms-client-principal'];
    if (!encoded)
        return null;
    const decoded = buffer_1.Buffer.from(encoded, 'base64').toString('utf8');
    return JSON.parse(decoded);
}
// Security middleware (API key OR ACA Entra group claim)
app.use((req, res, next) => {
    const apiKey = req.header('x-api-key');
    const user = extractUser(req);
    const apiKeyOk = !PROXY_API_KEY || apiKey === PROXY_API_KEY;
    const groupOk = REQUIRED_GROUPS.length === 0 || (user &&
        user.claims?.some((c) => c.typ === 'groups' && REQUIRED_GROUPS.includes(c.val)));
    if (apiKeyOk || groupOk) {
        req.user = user;
        return next();
    }
    return res.status(401).send('Unauthorized');
});
// Consolidation logic
let consolidatedModel = {};
let consolidatedCapabilities = {};
let groupTypeToBackend = {};
async function fetchMeta(server) {
    const headers = {};
    if (server.apiKey)
        headers['x-api-key'] = server.apiKey;
    const [model, capabilities] = await Promise.all([
        axios_1.default.get(`${server.url}/model`, { headers }).then(r => r.data),
        axios_1.default.get(`${server.url}/capabilities`, { headers }).then(r => r.data),
    ]);
    return { model, capabilities };
}
async function initialize() {
    for (const server of downstreams) {
        try {
            const { model, capabilities } = await fetchMeta(server);
            consolidatedModel = { ...consolidatedModel, ...model };
            consolidatedCapabilities = { ...consolidatedCapabilities, ...capabilities };
            if (model.groups) {
                for (const groupType of Object.keys(model.groups)) {
                    if (groupTypeToBackend[groupType]) {
                        throw new Error(`Conflict: groupType "${groupType}" defined by multiple servers`);
                    }
                    groupTypeToBackend[groupType] = server;
                }
            }
        }
        catch (err) {
            console.error(`Initialization failed for ${server.url}: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    }
}
// Owned routes
app.get('/', (_, res) => res.json({ model: consolidatedModel, capabilities: consolidatedCapabilities }));
app.get('/model', (_, res) => res.json(consolidatedModel));
app.get('/capabilities', (_, res) => res.json(consolidatedCapabilities));
// Proxy handlerapp.use('/:groupType/*', (req, res, next) => {  const { groupType } = req.params;  const backend = groupTypeToBackend[groupType];  if (!backend) {    res.status(404).send(`Unknown groupType: "${groupType}"`);    return;  }  const pathTail = req.originalUrl.split(groupType).slice(1).join(groupType);  return createProxyMiddleware({    target: backend.url,    changeOrigin: true,    pathRewrite: () => `/${groupType}${pathTail}`,    onProxyReq: proxyReq => {      proxyReq.setHeader(BASE_URL_HEADER, BASE_URL);      if (backend.apiKey) proxyReq.setHeader('x-api-key', backend.apiKey);    },  })(req, res, next);});
// Start
initialize().then(() => {
    app.listen(PORT, () => {
        console.log(`xRegistry Proxy running at ${BASE_URL}`);
    });
});
//# sourceMappingURL=proxy.js.map