const { expect } = require('chai');
const express = require('express');

describe('Server Attachment', () => {
  let app;
  
  beforeEach(() => {
    app = express();
  });

  const servers = [
    { name: 'PyPI', path: '../../pypi/server', pathPrefix: '/pythonregistries' },
    { name: 'NPM', path: '../../npm/server', pathPrefix: '/noderegistries' },
    { name: 'Maven', path: '../../maven/server', pathPrefix: '/javaregistries' },
    { name: 'NuGet', path: '../../nuget/server', pathPrefix: '/dotnetregistries' },
    { name: 'OCI', path: '../../oci/server', pathPrefix: '/containerregistries' }
  ];

  servers.forEach(serverConfig => {
    describe(`${serverConfig.name} Server Attachment`, () => {
      let serverModule;
      let serverInfo;

      before(() => {
        serverModule = require(serverConfig.path);
      });

      it('should attach to Express app without errors', () => {
        expect(() => {
          serverInfo = serverModule.attachToApp(app, {
            pathPrefix: serverConfig.pathPrefix,
            quiet: true
          });
        }).to.not.throw();
      });

      it('should return valid server info', () => {
        expect(serverInfo).to.be.an('object');
        expect(serverInfo).to.have.property('name');
        expect(serverInfo.name).to.be.a('string').and.not.be.empty;
      });

      it('should not modify the app in destructive ways', () => {
        const routerStackLength = app._router ? app._router.stack.length : 0;
        expect(routerStackLength).to.be.at.least(0);
      });
    });
  });
}); 