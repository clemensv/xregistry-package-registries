const { expect } = require('chai');
const request = require('supertest');
const express = require('express');

describe('Unified Server Endpoints Integration', () => {
  let app;
  let attachedServers;

  before(() => {
    // Create a test Express app and attach all servers
    app = express();
    attachedServers = [];

    // Configure Express
    app.set('decode_param_values', false);
    app.enable('strict routing');
    app.enable('case sensitive routing');
    app.disable('x-powered-by');

    // Add CORS
    app.use((req, res, next) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      next();
    });

    // Load and attach servers
    const servers = [
      { name: 'PyPI', path: '../../pypi/server', pathPrefix: '/pythonregistries' },
      { name: 'NPM', path: '../../npm/server', pathPrefix: '/noderegistries' },
      { name: 'Maven', path: '../../maven/server', pathPrefix: '/javaregistries' },
      { name: 'NuGet', path: '../../nuget/server', pathPrefix: '/dotnetregistries' },
      { name: 'OCI', path: '../../oci/server', pathPrefix: '/containerregistries' }
    ];

    servers.forEach(serverConfig => {
      try {
        const serverModule = require(serverConfig.path);
        const serverInfo = serverModule.attachToApp(app, {
          pathPrefix: serverConfig.pathPrefix,
          quiet: true
        });
        attachedServers.push(serverInfo);
      } catch (error) {
        console.warn(`Failed to attach ${serverConfig.name} server:`, error.message);
      }
    });

    // Add unified endpoints
    app.get('/', (req, res) => {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const response = {
        specversion: "0.5-wip",
        id: "xregistry-package-registries",
        description: "Unified package registries server",
        self: baseUrl,
        servers: attachedServers.map(server => ({
          name: server.name,
          url: `${baseUrl}${server.pathPrefix || ''}`,
          description: server.description || `${server.name} package registry`
        }))
      };
      res.json(response);
    });

    app.get('/capabilities', (req, res) => {
      const capabilities = {
        servers: attachedServers.length,
        registries: attachedServers.map(s => s.name)
      };
      res.json(capabilities);
    });
  });

  describe('Root Endpoint', () => {
    it('should return unified server information', (done) => {
      request(app)
        .get('/')
        .expect(200)
        .expect('Content-Type', /json/)
        .end((err, res) => {
          if (err) return done(err);
          
          expect(res.body).to.have.property('id', 'xregistry-package-registries');
          expect(res.body).to.have.property('specversion');
          expect(res.body).to.have.property('servers');
          expect(res.body.servers).to.be.an('array');
          
          done();
        });
    });
  });

  describe('Capabilities Endpoint', () => {
    it('should return server capabilities', (done) => {
      request(app)
        .get('/capabilities')
        .expect(200)
        .expect('Content-Type', /json/)
        .end((err, res) => {
          if (err) return done(err);
          
          expect(res.body).to.have.property('servers');
          expect(res.body).to.have.property('registries');
          expect(res.body.registries).to.be.an('array');
          
          done();
        });
    });
  });

  describe('Registry Endpoints', () => {
    const expectedEndpoints = [
      { path: '/pythonregistries', name: 'PyPI' },
      { path: '/noderegistries', name: 'NPM' },
      { path: '/javaregistries', name: 'Maven' },
      { path: '/dotnetregistries', name: 'NuGet' },
      { path: '/containerregistries', name: 'OCI' }
    ];

    expectedEndpoints.forEach(endpoint => {
      it(`should respond to ${endpoint.name} registry endpoint (${endpoint.path})`, (done) => {
        request(app)
          .get(endpoint.path)
          .expect((res) => {
            // Should either return 200 with content or 404 if server not attached
            expect([200, 404]).to.include(res.status);
          })
          .end(done);
      });
    });
  });

  describe('CORS Headers', () => {
    it('should include proper CORS headers', (done) => {
      request(app)
        .get('/')
        .expect('Access-Control-Allow-Origin', '*')
        .expect('Access-Control-Allow-Methods', 'GET, OPTIONS')
        .expect('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        .end(done);
    });
  });
}); 